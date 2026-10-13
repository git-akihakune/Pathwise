import { MockLanguageModelV4 } from "ai/test";
import { eq } from "drizzle-orm";
import { beforeEach, expect, it, vi } from "vitest";
import { getTestDb, resetDb } from "../../../../test/integration/db";
import {
  fakeLlm,
  fakeQueue,
  jsonReply,
  seedProvider,
  seedUser,
  testDeps,
  textReply,
} from "../../../../test/integration/fixtures";
import { SAFETY_RESPONSE } from "../agent/distress";
import { schema } from "../db";
import { resolveLlm } from "../llm";
import { addMemory, listMemory } from "../services/memory";
import { createPlan, mondayOf } from "../services/plan";
import { createProposal, listProposals } from "../services/proposals";
import {
  appendMessage,
  getOrStartSession,
  getSessionState,
  setCuratedThrough,
} from "../services/sessions";
import { curateSession } from "./curator";

vi.mock("../llm", async (orig) => ({
  ...(await orig<typeof import("../llm")>()),
  resolveLlm: vi.fn(),
}));
const db = getTestDb();
const deps = { ...testDeps(db), queue: fakeQueue() };
let pc: string;
const extraction = (
  o: Partial<{ memories: object[]; stories: object[]; actionUpdates: object[] }>,
) =>
  new MockLanguageModelV4({
    doGenerate: jsonReply({ memories: [], stories: [], actionUpdates: [], ...o }),
  });
const useModels = (models: Record<string, MockLanguageModelV4>) =>
  vi.mocked(resolveLlm).mockResolvedValue(
    fakeLlm({
      userId: "u1",
      providerConfigId: pc,
      models: {
        "session.summarize": new MockLanguageModelV4({
          doGenerate: textReply("Talked about remote work."),
        }),
        ...models,
      },
    }),
  );
async function session(texts: string[]) {
  const s = await getOrStartSession(db, "u1");
  for (const t of texts) {
    await appendMessage(db, "u1", s.id, { role: "user", parts: [{ type: "text", text: t }] });
  }
  return s.id;
}
const idleFor = (id: string, minutes: number) =>
  db
    .update(schema.sessions)
    .set({ lastMessageAt: new Date(Date.now() - minutes * 60_000) })
    .where(eq(schema.sessions.id, id));
const mem = (category: string, content: string, confidence: number, sensitive: boolean) => ({
  category,
  content,
  confidence,
  sensitive,
});
const allMemory = () =>
  listMemory(db, "u1", { status: ["active", "pending", "rejected", "superseded"] });
beforeEach(async () => {
  await resetDb(db);
  await seedUser(db, "u1");
  pc = await seedProvider(db, "u1");
});

it("waits until the session has been idle for 30 minutes (Review Focus 4)", async () => {
  useModels({ "curate.extract": extraction({}) });
  const sid = await session(["I prefer remote work"]);
  expect((await curateSession(deps, "u1", sid)).status).toBe("not_idle");
  await idleFor(sid, 28);
  expect((await curateSession(deps, "u1", sid)).status).toBe("not_idle");
  await idleFor(sid, 31);
  expect((await curateSession(deps, "u1", sid)).status).toBe("done");
});
it("routes by sensitivity and confidence, proposes stories and action updates, and is idempotent (Review Focus 4)", async () => {
  const plan = await createPlan(db, "u1", {
    northStar: "RN",
    milestones: [{ title: "M" }],
    actions: [{ title: "Finish the anatomy course", weekOf: mondayOf(new Date(), "UTC") }],
  });
  const action = plan.actions[0] as (typeof plan.actions)[number];
  useModels({
    "curate.extract": extraction({
      memories: [
        mem("preference", "Prefers remote work", 0.9, false),
        mem("constraint", "Visa expires in 2027", 0.95, true),
        mem("aspiration", "Might want to teach", 0.6, false),
      ],
      stories: [
        {
          title: "Triage pilot",
          situation: "ER backlog",
          task: "Cut waits",
          action: "Ran nurse-led triage",
          result: "Waits fell 30%",
          metrics: "30%",
          skills: [],
        },
      ],
      actionUpdates: [
        { actionId: action.id, status: "done" },
        { actionId: crypto.randomUUID(), status: "done" },
      ],
    }),
  });
  const sid = await session(["I finished the anatomy course!", "I prefer remote work"]);
  await idleFor(sid, 31);
  expect(await curateSession(deps, "u1", sid)).toEqual({
    status: "done",
    active: 1,
    pending: 2,
    superseded: 0,
    duplicates: 0,
    proposals: 2,
  });
  expect((await allMemory()).map((m) => [m.content, m.status, m.sourceType]).sort()).toEqual([
    ["Might want to teach", "pending", "message"],
    ["Prefers remote work", "active", "message"],
    ["Visa expires in 2027", "pending", "message"],
  ]);
  expect((await listProposals(db, "u1")).map((p) => p.kind).sort()).toEqual([
    "action_status_update",
    "story_add",
  ]);
  expect(
    (await listProposals(db, "u1")).find((p) => p.kind === "action_status_update")?.payload,
  ).toEqual({
    updates: [{ actionId: action.id, status: "done", basedOnVersion: action.version }],
  });
  const state = await getSessionState(db, "u1", sid);
  expect(state.summary).toBe("Talked about remote work.");
  expect(state.curatedThroughMessageId).not.toBeNull();
  expect((await curateSession(deps, "u1", sid)).status).toBe("no_new_messages");
  expect(await allMemory()).toHaveLength(3);
});
it("supersedes on 'update', drops 'duplicate', and skips facts already proposed in chat", async () => {
  const old = await addMemory(db, "u1", {
    category: "preference",
    content: "Prefers remote work",
    sourceType: "manual",
    sourceId: null,
    confidence: 1,
    sensitive: false,
    status: "active",
  });
  const sid = await session([
    "I want fully remote work, and I love mentoring",
    "I enjoy mentoring juniors",
  ]);
  await createProposal(db, "u1", {
    kind: "memory_add",
    payload: { category: "energizer", content: "Enjoys mentoring juniors", sensitive: false },
    sessionId: sid,
  });
  useModels({
    "curate.extract": extraction({
      memories: [
        mem("preference", "Prefers fully remote work, ideally", 0.9, false),
        mem("energizer", "enjoys mentoring juniors", 0.9, false),
      ],
    }),
    "curate.dedupe": new MockLanguageModelV4({ doGenerate: jsonReply({ decision: "update" }) }),
  });
  await idleFor(sid, 31);
  expect(await curateSession(deps, "u1", sid)).toMatchObject({
    active: 1,
    superseded: 1,
    duplicates: 1,
  });
  const items = await allMemory();
  expect(items.find((m) => m.id === old.id)?.status).toBe("superseded");
  expect(items.find((m) => m.status === "active")).toMatchObject({
    content: "Prefers fully remote work, ideally",
    supersedesId: old.id,
  });
});
it("treats an 'update' against a pending near match as a duplicate (R9)", async () => {
  await addMemory(db, "u1", {
    category: "preference",
    content: "Prefers remote work",
    sourceType: "manual",
    sourceId: null,
    confidence: 0.5,
    sensitive: false,
    status: "pending",
  });
  const sid = await session(["I want fully remote work"]);
  useModels({
    "curate.extract": extraction({
      memories: [mem("preference", "Prefers fully remote work", 0.9, false)],
    }),
    "curate.dedupe": new MockLanguageModelV4({ doGenerate: jsonReply({ decision: "update" }) }),
  });
  await idleFor(sid, 31);
  expect(await curateSession(deps, "u1", sid)).toMatchObject({
    status: "done",
    active: 0,
    pending: 0,
    duplicates: 1,
  });
  expect(await allMemory()).toHaveLength(1);
});
it("skips users without a provider", async () => {
  vi.mocked(resolveLlm).mockResolvedValue(null);
  const sid = await session(["hi"]);
  await idleFor(sid, 31);
  expect((await curateSession(deps, "u1", sid)).status).toBe("no_provider");
});

it("tolerates 60 s of clock skew in the idle check, but no more", async () => {
  useModels({ "curate.extract": extraction({}) });
  const sid = await session(["I prefer remote work"]);
  await idleFor(sid, 28.9); // 30 min - 66 s: still too recent
  expect((await curateSession(deps, "u1", sid)).status).toBe("not_idle");
  await idleFor(sid, 29.2); // 30 min - 48 s: within tolerance
  expect((await curateSession(deps, "u1", sid)).status).toBe("done");
});

it("writes nothing when the watermark moved during the LLM calls (compare-and-set)", async () => {
  const sid = await session(["I prefer remote work", "And I like mornings"]);
  const msgs = await db.select().from(schema.messages).where(eq(schema.messages.sessionId, sid));
  const first = msgs.sort((a, b) => a.seq - b.seq)[0]?.id as string;
  useModels({
    "curate.extract": new MockLanguageModelV4({
      doGenerate: async () => {
        await setCuratedThrough(db, "u1", sid, first); // a concurrent run finished meanwhile
        return jsonReply({
          memories: [mem("preference", "Prefers remote work", 0.9, false)],
          stories: [],
          actionUpdates: [],
        });
      },
    }),
  });
  await idleFor(sid, 31);
  expect((await curateSession(deps, "u1", sid)).status).toBe("no_new_messages");
  expect(await allMemory()).toEqual([]);
  expect((await getSessionState(db, "u1", sid)).curatedThroughMessageId).toBe(first);
});

it("keeps safety-response turns out of the curator input", async () => {
  const extract = extraction({});
  useModels({ "curate.extract": extract });
  const s = await getOrStartSession(db, "u1");
  for (const [role, t] of [
    ["user", "I want to end my life"],
    ["assistant", SAFETY_RESPONSE([{ name: "Find a Helpline", url: "https://findahelpline.com" }])],
    ["user", "I prefer remote work"],
  ] as const) {
    await appendMessage(db, "u1", s.id, { role, parts: [{ type: "text", text: t }] });
  }
  await idleFor(s.id, 31);
  expect((await curateSession(deps, "u1", s.id)).status).toBe("done");
  const prompt = JSON.stringify(extract.doGenerateCalls[0]?.prompt);
  expect(prompt).toContain("I prefer remote work");
  expect(prompt).not.toContain("end my life");
  expect(prompt).not.toContain("findahelpline");
});
