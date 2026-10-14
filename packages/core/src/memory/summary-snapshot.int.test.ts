import { MockLanguageModelV4 } from "ai/test";
import { eq } from "drizzle-orm";
import { beforeEach, expect, it, vi } from "vitest";
import { getTestDb, resetDb } from "../../../../test/integration/db";
import {
  fakeLlm,
  seedProvider,
  seedUser,
  testDeps,
  textReply,
} from "../../../../test/integration/fixtures";
import { schema } from "../db";
import { resolveLlm } from "../llm";
import { createSkill, getProfile } from "../services/profile";
import {
  appendMessage,
  getOrStartSession,
  getSessionState,
  messagesAfter,
} from "../services/sessions";
import { getSnapshotText, refreshSnapshot, renderProfileFallback } from "./snapshot";
import { summarizeSession } from "./summarize";

vi.mock("../llm", async (orig) => ({
  ...(await orig<typeof import("../llm")>()),
  resolveLlm: vi.fn(),
}));
const db = getTestDb();
const deps = testDeps(db);
let pc: string;
beforeEach(async () => {
  await resetDb(db);
  await seedUser(db, "u1");
  pc = await seedProvider(db, "u1");
});

it("summarizes all but the last 4 messages and advances the window", async () => {
  const s = await getOrStartSession(db, "u1");
  for (let i = 1; i <= 10; i++) {
    await appendMessage(db, "u1", s.id, {
      role: i % 2 ? "user" : "assistant",
      parts: [{ type: "text", text: `message ${i}` }],
    });
  }
  const fast = new MockLanguageModelV4({ doGenerate: textReply("Discussed nursing options.") });
  expect(
    await summarizeSession(
      deps,
      fakeLlm({ userId: "u1", providerConfigId: pc, models: { "session.summarize": fast } }),
      "u1",
      s.id,
      { keepLast: 4 },
    ),
  ).toBe(true);
  const state = await getSessionState(db, "u1", s.id);
  expect(state.summary).toBe("Discussed nursing options.");
  expect(
    (await messagesAfter(db, "u1", s.id, state.summarizedThroughMessageId)).map((m) => m.parts[0]),
  ).toEqual([7, 8, 9, 10].map((i) => ({ type: "text", text: `message ${i}` })));
  const prompt = JSON.stringify(fast.doGenerateCalls[0]?.prompt);
  expect(prompt).toContain("message 6");
  expect(prompt).not.toContain("message 7");
});
it("regenerates the snapshot with the fast model and records the profile version", async () => {
  await createSkill(db, "u1", {
    name: "Triage",
    level: "strong",
    evidence: null,
    sourceType: "manual",
    sourceId: null,
  });
  vi.mocked(resolveLlm).mockResolvedValue(
    fakeLlm({
      userId: "u1",
      providerConfigId: pc,
      models: {
        snapshot: new MockLanguageModelV4({ doGenerate: textReply("ER nurse, strong at triage.") }),
      },
    }),
  );
  await refreshSnapshot(deps, "u1");
  expect(await getSnapshotText(db, "u1")).toBe("ER nurse, strong at triage.");
  const [row] = await db
    .select()
    .from(schema.userSnapshot)
    .where(eq(schema.userSnapshot.userId, "u1"));
  const [settings] = await db
    .select()
    .from(schema.userSettings)
    .where(eq(schema.userSettings.userId, "u1"));
  expect(row?.profileVersion).toBe(settings?.profileVersion);
});
it("stores the deterministic fallback when there is no provider", async () => {
  await createSkill(db, "u1", {
    name: "Triage",
    level: null,
    evidence: null,
    sourceType: "manual",
    sourceId: null,
  });
  vi.mocked(resolveLlm).mockResolvedValue(null);
  await refreshSnapshot(deps, "u1");
  expect(await getSnapshotText(db, "u1")).toBe(
    renderProfileFallback(await getProfile(db, "u1"), []),
  );
});
it("stores the fallback when generation fails for a non-auth reason (R10b)", async () => {
  await createSkill(db, "u1", {
    name: "Triage",
    level: null,
    evidence: null,
    sourceType: "manual",
    sourceId: null,
  });
  vi.mocked(resolveLlm).mockResolvedValue(
    fakeLlm({
      userId: "u1",
      providerConfigId: pc,
      models: {
        snapshot: new MockLanguageModelV4({
          doGenerate: async () => {
            throw new Error("boom");
          },
        }),
      },
    }),
  );
  await refreshSnapshot(deps, "u1");
  const [row] = await db.select().from(schema.userSnapshot);
  expect(row?.content).toBe(renderProfileFallback(await getProfile(db, "u1"), []));
});
