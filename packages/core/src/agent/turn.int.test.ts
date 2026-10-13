import { APICallError, type UIMessage } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTestDb, resetDb } from "../../../../test/integration/db";
import {
  erroringStream,
  fakeLlm,
  fakeQueue,
  jsonReply,
  readUIStream,
  seedProvider,
  seedUser,
  testDeps,
  textStream,
  toolCallStream,
} from "../../../../test/integration/fixtures";
import { schema } from "../db";
import { LlmUnavailableError } from "../errors";
import { ensureInstanceSettings } from "../instance";
import { type Capabilities, requireLlm, resolveLlm } from "../llm";
import { listMemory } from "../services/memory";
import { listProposals } from "../services/proposals";
import { appendMessage, getOrStartSession, recentMessages } from "../services/sessions";
import {
  ELEVATED_DISTRESS_LINE,
  runTurn,
  SAFETY_RESPONSE,
  type TurnInput,
  type TurnResult,
} from ".";

vi.mock("../llm", async (orig) => ({
  ...(await orig<typeof import("../llm")>()),
  resolveLlm: vi.fn(),
  requireLlm: vi.fn(),
}));

const db = getTestDb();
let pc: string;
const userMsg = (text: string, id: string = crypto.randomUUID()): UIMessage => ({
  id,
  role: "user",
  parts: [{ type: "text", text }],
});
const classifyAs = (skills: string[], distress = "none") =>
  new MockLanguageModelV4({ doGenerate: jsonReply({ skills, distress }) });
const tooLong = () =>
  new APICallError({
    message: "This model's maximum context length is 8192 tokens",
    url: "x",
    requestBodyValues: {},
    statusCode: 400,
    isRetryable: false,
  });
const denied = () =>
  new MockLanguageModelV4({
    doGenerate: async () => {
      throw new APICallError({
        message: "bad key",
        url: "x",
        requestBodyValues: {},
        statusCode: 401,
        isRetryable: false,
      });
    },
  });
const SAFETY = SAFETY_RESPONSE([{ name: "Find a Helpline", url: "https://findahelpline.com" }]);

function useLlm(
  models: Record<string, MockLanguageModelV4>,
  capabilities: Partial<Capabilities> = {},
) {
  const llm = fakeLlm({ userId: "u1", providerConfigId: pc, models, capabilities });
  vi.mocked(resolveLlm).mockResolvedValue(llm);
  vi.mocked(requireLlm).mockResolvedValue(llm);
}

async function turn(
  models: Record<string, MockLanguageModelV4>,
  message: UIMessage,
  extra: Partial<TurnInput> = {},
  capabilities: Partial<Capabilities> = {},
) {
  useLlm(models, capabilities);
  const queue = fakeQueue();
  let result: TurnResult | undefined;
  const res = await runTurn(
    { ...testDeps(db), queue },
    { userId: "u1", message, screen: "coach", ...extra },
    {
      onTurnEnd: async (r) => {
        await new Promise((ok) => setTimeout(ok, 50));
        result = r;
      },
    },
  );
  const chunks = await readUIStream(res);
  expect(result).toBeDefined(); // the body closes only after onTurnEnd resolves (Plan 5 relies on this)
  return { chunks, result: result as TurnResult, queue };
}
async function seedLongSession() {
  const s = await getOrStartSession(db, "u1");
  for (let i = 0; i < 40; i++) {
    await appendMessage(db, "u1", s.id, {
      role: i % 2 ? "assistant" : "user",
      parts: [{ type: "text", text: "abcd".repeat(400) }],
    });
  }
  return s.id;
}
beforeEach(async () => {
  await resetDb(db);
  await ensureInstanceSettings(db);
  await seedUser(db, "u1");
  pc = await seedProvider(db, "u1");
});

describe("runTurn", () => {
  it("streams a reply, persists both messages with skills and usage, and schedules curation", async () => {
    const { result, queue } = await turn(
      {
        classify: classifyAs(["direction"]),
        chat: new MockLanguageModelV4({ doStream: textStream("Hello", " there.") }),
      },
      userMsg("I want a change"),
    );
    expect(result).toMatchObject({ status: "complete", text: "Hello there.", safety: false });
    expect((await recentMessages(db, "u1", result.sessionId)).map((m) => m.role)).toEqual([
      "user",
      "assistant",
    ]);
    const [row] = await db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.id, result.assistantMessageId));
    expect(row).toMatchObject({
      status: "complete",
      skills: ["core", "direction"],
      inputTokens: 10,
      outputTokens: 5,
    });
    expect(
      await db.select().from(schema.llmUsage).where(eq(schema.llmUsage.purpose, "chat")),
    ).toMatchObject([{ role: "main", model: "fake-main", inputTokens: 10, outputTokens: 5 }]);
    expect(queue.sent).toContainEqual({
      name: "session.curate",
      data: { userId: "u1", sessionId: result.sessionId },
      opts: { startAfterSeconds: 1800 },
    });
  });

  it("turns tool calls into proposals tied to the assistant message, never into data", async () => {
    const chat = new MockLanguageModelV4({
      doStream: [
        toolCallStream("proposeMemory", {
          category: "preference",
          content: "Prefers remote work",
          sensitive: false,
        }),
        textStream("I've suggested saving that."),
      ],
    });
    const { result } = await turn(
      { classify: classifyAs([]), chat },
      userMsg("Remember I prefer remote work"),
    );
    expect(await listProposals(db, "u1")).toMatchObject([
      { kind: "memory_add", messageId: result.assistantMessageId, status: "pending" },
    ]);
    expect(await listMemory(db, "u1")).toEqual([]);
    const [, assistant] = await recentMessages(db, "u1", result.sessionId);
    expect(assistant?.parts).toContainEqual(
      expect.objectContaining({ type: "tool-proposeMemory", state: "output-available" }),
    );
  });

  it("turns a failing tool into a tool error the model sees, without failing the turn", async () => {
    const chat = new MockLanguageModelV4({
      doStream: [
        toolCallStream("getOccupation", { idOrCode: "99-9999.99" }),
        textStream("I couldn't find that occupation."),
      ],
    });
    const { result } = await turn(
      { classify: classifyAs(["direction"]), chat },
      userMsg("Look it up"),
    );
    expect(result).toMatchObject({ status: "complete", text: "I couldn't find that occupation." });
    const [, assistant] = await recentMessages(db, "u1", result.sessionId);
    expect(assistant?.parts).toContainEqual(
      expect.objectContaining({
        type: "tool-getOccupation",
        state: "output-error",
        errorText: "No occupation matches “99-9999.99”.",
      }),
    );
    expect(JSON.stringify(chat.doStreamCalls[1]?.prompt)).toContain("No occupation matches");
  });

  it("answers acute distress with the safety response and no main-model call (Review Focus 1)", async () => {
    const chat = new MockLanguageModelV4({ doStream: textStream("should not run") });
    const { result } = await turn(
      { classify: classifyAs([], "acute"), chat },
      userMsg("I don't see the point anymore"),
    );
    expect(result.text).toBe(SAFETY);
    expect(result.safety).toBe(true);
    expect(result.safety).toBe(true);
    expect(chat.doStreamCalls).toHaveLength(0);
    const [row] = await db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.id, result.assistantMessageId));
    expect(row).toMatchObject({ status: "complete", skills: [] });
  });

  it("gives the safety response on keyword distress without consulting a broken classifier (Review Focus 1)", async () => {
    const broken = new MockLanguageModelV4({
      doGenerate: async () => {
        throw new APICallError({
          message: "boom",
          url: "x",
          requestBodyValues: {},
          statusCode: 500,
          isRetryable: false,
        });
      },
    });
    const chat = new MockLanguageModelV4({ doStream: textStream("should not run") });
    const { result } = await turn({ classify: broken, chat }, userMsg("I want to end my life"));
    expect(result.text).toBe(SAFETY);
    expect(result.safety).toBe(true);
    expect(broken.doGenerateCalls).toHaveLength(0);
    expect(chat.doStreamCalls).toHaveLength(0);
  });

  it("gives the safety response on keyword distress even when the key is rejected (R17)", async () => {
    const classify = denied();
    const chat = new MockLanguageModelV4({ doStream: textStream("should not run") });
    const { result } = await turn({ classify, chat }, userMsg("I want to end my life"));
    expect(result.text).toBe(SAFETY);
    expect(result.safety).toBe(true);
    expect(classify.doGenerateCalls).toHaveLength(0);
    expect(chat.doStreamCalls).toHaveLength(0);
  });

  it("checks keyword distress on workflow turns (R17)", async () => {
    const chat = new MockLanguageModelV4({ doStream: textStream("should not run") });
    const { result } = await turn({ classify: classifyAs([]), chat }, userMsg("I can't go on"), {
      workflow: {
        runId: crypto.randomUUID(),
        stepId: "intake",
        skills: [],
        goal: "Get to know them",
      },
    });
    expect(result.text).toBe(SAFETY);
    expect(result.safety).toBe(true);
    expect(chat.doStreamCalls).toHaveLength(0);
  });

  it("surfaces a key rejected during classification as LlmUnavailableError('auth_failed') (R11)", async () => {
    useLlm({ classify: denied(), chat: new MockLanguageModelV4({ doStream: textStream("no") }) });
    await expect(
      runTurn(
        { ...testDeps(db), queue: fakeQueue() },
        { userId: "u1", message: userMsg("hi there") },
      ),
    ).rejects.toMatchObject({ name: "LlmUnavailableError", reason: "auth_failed" });
    const [config] = await db
      .select()
      .from(schema.providerConfigs)
      .where(eq(schema.providerConfigs.id, pc));
    expect(config?.authFailed).toBe(true);
  });

  it("adds the slow-down instruction for elevated distress", async () => {
    const chat = new MockLanguageModelV4({ doStream: textStream("I hear you.") });
    await turn(
      { classify: classifyAs([], "elevated"), chat },
      userMsg("I'm exhausted by all of this"),
    );
    expect(JSON.stringify(chat.doStreamCalls[0]?.prompt)).toContain(ELEVATED_DISTRESS_LINE);
  });

  it("skips the classifier inside a workflow and injects the step goal", async () => {
    const classify = classifyAs(["direction"]);
    const chat = new MockLanguageModelV4({ doStream: textStream("Tell me more.") });
    const { result } = await turn({ classify, chat }, userMsg("Hi"), {
      workflow: {
        runId: crypto.randomUUID(),
        stepId: "intake",
        skills: ["planning"],
        goal: "Cover values and constraints",
      },
    });
    expect(classify.doGenerateCalls).toHaveLength(0);
    expect(JSON.stringify(chat.doStreamCalls[0]?.prompt)).toContain(
      "Current step goal: Cover values and constraints",
    );
    const [row] = await db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.id, result.assistantMessageId));
    expect(row?.skills).toEqual(["core", "planning"]);
  });

  it("chats without tools when the model can't call them", async () => {
    const chat = new MockLanguageModelV4({ doStream: textStream("OK.") });
    await turn({ classify: classifyAs(["planning"]), chat }, userMsg("Plan"), {}, { tools: false });
    expect(chat.doStreamCalls[0]?.tools ?? []).toEqual([]);
  });

  it("keeps a reply cut off mid-stream as interrupted, and regenerating replaces it (Review Focus 2)", async () => {
    const chat = new MockLanguageModelV4({
      doStream: [
        erroringStream(
          ["Here is a partial"],
          new APICallError({
            message: "upstream died",
            url: "x",
            requestBodyValues: {},
            statusCode: 502,
            isRetryable: false,
          }),
        ),
        textStream("Full answer."),
      ],
    });
    const m = userMsg("Plan my week");
    const first = await turn({ classify: classifyAs([]), chat }, m);
    expect(first.result.status).toBe("interrupted");
    expect(first.chunks).toContainEqual({
      type: "error",
      errorText: "The AI provider had a problem. Retry in a moment.",
    });
    expect((await recentMessages(db, "u1", first.result.sessionId))[1]).toMatchObject({
      metadata: { status: "interrupted" },
      parts: expect.arrayContaining([
        expect.objectContaining({ type: "text", text: "Here is a partial" }),
      ]),
    });
    const second = await turn({ classify: classifyAs([]), chat }, m);
    expect(second.result).toMatchObject({
      status: "complete",
      text: "Full answer.",
      sessionId: first.result.sessionId,
    });
    expect(
      (await recentMessages(db, "u1", first.result.sessionId)).map((x) => [
        x.role,
        x.metadata?.status,
      ]),
    ).toEqual([
      ["user", "complete"],
      ["assistant", "complete"],
    ]);
  });

  it("retries once with a 30% smaller budget on context-length errors (Review Focus 3)", async () => {
    const sessionId = await seedLongSession();
    let calls = 0;
    const chat = new MockLanguageModelV4({
      doStream: async () => {
        calls++;
        if (calls === 1) throw tooLong();
        return textStream("Shorter now.");
      },
    });
    const { result, queue } = await turn(
      { classify: classifyAs([]), chat },
      userMsg("Next?"),
      {},
      { contextWindow: 8192 },
    );
    expect(result).toMatchObject({ text: "Shorter now.", sessionId });
    expect(chat.doStreamCalls).toHaveLength(2);
    expect(chat.doStreamCalls[1]?.prompt.length).toBeLessThan(
      chat.doStreamCalls[0]?.prompt.length ?? 0,
    );
    expect(queue.sent).toContainEqual({
      name: "session.summarize",
      data: { userId: "u1", sessionId },
      opts: { singletonKey: sessionId },
    });
  });

  it("suggests a new session when the smaller budget still fails (Review Focus 3)", async () => {
    const chat = new MockLanguageModelV4({
      doStream: async () => {
        throw tooLong();
      },
    });
    const { chunks, result } = await turn({ classify: classifyAs([]), chat }, userMsg("Next?"));
    expect(chunks).toContainEqual({
      type: "error",
      errorText: "This conversation is too long for the model. Start a new session to continue.",
    });
    expect((await recentMessages(db, "u1", result.sessionId)).map((m) => m.role)).toEqual(["user"]);
  });

  it.each(["none", "auth_failed"] as const)(
    "refuses without a usable provider (%s) and stores nothing",
    async (reason) => {
      vi.mocked(requireLlm).mockRejectedValue(new LlmUnavailableError(reason));
      await expect(
        runTurn({ ...testDeps(db), queue: fakeQueue() }, { userId: "u1", message: userMsg("hi") }),
      ).rejects.toMatchObject({ reason });
      expect(await db.select().from(schema.messages)).toEqual([]);
    },
  );

  it.each(["none", "auth_failed"] as const)(
    "still answers a crisis message with the safety response without a usable provider (%s) (R17)",
    async (reason) => {
      vi.mocked(requireLlm).mockRejectedValue(new LlmUnavailableError(reason));
      const queue = fakeQueue();
      let result: TurnResult | undefined;
      const res = await runTurn(
        { ...testDeps(db), queue },
        { userId: "u1", message: userMsg("I want to end my life") },
        {
          onTurnEnd: async (r) => {
            result = r;
          },
        },
      );
      await readUIStream(res);
      expect(result).toMatchObject({ status: "complete", text: SAFETY, safety: true });
      expect((await recentMessages(db, "u1", result?.sessionId ?? "")).map((m) => m.role)).toEqual([
        "user",
        "assistant",
      ]);
      expect(await db.select().from(schema.llmUsage)).toEqual([]);
    },
  );
});
