import { beforeEach, expect, it } from "vitest";
import { getTestDb, resetDb } from "../../../../../test/integration/db";
import {
  fakeLlm,
  runTool,
  seedProvider,
  seedUser,
  testDeps,
} from "../../../../../test/integration/fixtures";
import { addMemory, listMemory } from "../../services/memory";
import { listProposals } from "../../services/proposals";
import { appendMessage, getOrStartSession } from "../../services/sessions";
import { getSkill, type SkillContext } from "..";

const db = getTestDb();
let ctx: SkillContext;
beforeEach(async () => {
  await resetDb(db);
  await seedUser(db, "u1");
  const pc = await seedProvider(db, "u1");
  const s = await getOrStartSession(db, "u1");
  const { id: messageId } = await appendMessage(db, "u1", s.id, {
    role: "assistant",
    parts: [],
    status: "interrupted",
  });
  ctx = {
    deps: testDeps(db),
    llm: fakeLlm({ userId: "u1", providerConfigId: pc, models: {} }),
    userId: "u1",
    sessionId: s.id,
    messageId,
    timezone: "UTC",
  };
});

it("exposes exactly the four core tools", () =>
  expect(Object.keys(getSkill("core").tools(ctx)).sort()).toEqual([
    "proposeMemory",
    "proposeProfileUpdate",
    "proposeStory",
    "searchMemory",
  ]));
it("proposeMemory creates a pending proposal and writes nothing else", async () => {
  const out = await runTool(getSkill("core").tools(ctx), "proposeMemory", {
    category: "preference",
    content: "Prefers remote work",
    sensitive: false,
  });
  expect(out).toEqual({ proposalId: expect.any(String) });
  expect(await listProposals(db, "u1")).toMatchObject([
    {
      kind: "memory_add",
      status: "pending",
      sessionId: ctx.sessionId,
      messageId: ctx.messageId,
      payload: { content: "Prefers remote work" },
    },
  ]);
  expect(await listMemory(db, "u1")).toEqual([]);
});
it("proposeStory and proposeProfileUpdate create proposals of their kinds", async () => {
  const tools = getSkill("core").tools(ctx);
  await runTool(tools, "proposeStory", {
    title: "Cut wait times",
    situation: "ER backlog",
    task: "Triage redesign",
    action: "Piloted nurse-led triage",
    result: "Waits fell 30%",
    metrics: "30%",
    skills: ["Triage"],
  });
  await runTool(tools, "proposeProfileUpdate", {
    entity: "skill",
    op: "create",
    fields: { name: "Triage", level: "strong" },
  });
  expect((await listProposals(db, "u1")).map((p) => p.kind).sort()).toEqual([
    "profile_update",
    "story_add",
  ]);
});
it("throws for a proposal the engine rejects, so the model sees a tool error", async () =>
  await expect(
    runTool(getSkill("core").tools(ctx), "proposeProfileUpdate", {
      entity: "skill",
      op: "update",
      id: crypto.randomUUID(),
      fields: { name: "X" },
    }),
  ).rejects.toThrow());
it("searchMemory returns active memories", async () => {
  await addMemory(db, "u1", {
    category: "value",
    content: "Values fairness at work",
    sourceType: "manual",
    sourceId: null,
    confidence: 1,
    sensitive: false,
    status: "active",
  });
  expect(await runTool(getSkill("core").tools(ctx), "searchMemory", { query: "fairness" })).toEqual(
    {
      results: [
        {
          kind: "memory",
          text: "Values fairness at work",
          category: "value",
          date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        },
      ],
    },
  );
});
it("tool input schemas convert to JSON schema (no transforms)", async () => {
  const { z } = await import("zod");
  const tools = getSkill("core").tools(ctx);
  for (const t of Object.values(tools)) {
    expect(() => z.toJSONSchema(t.inputSchema as never, { io: "output" })).not.toThrow();
  }
});
