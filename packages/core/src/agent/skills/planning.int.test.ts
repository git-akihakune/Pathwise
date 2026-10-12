import { beforeEach, expect, it } from "vitest";
import { getTestDb, resetDb } from "../../../../../test/integration/db";
import {
  fakeLlm,
  runTool,
  seedProvider,
  seedUser,
  testDeps,
} from "../../../../../test/integration/fixtures";
import { createPlan, mondayOf } from "../../services/plan";
import { listProposals } from "../../services/proposals";
import { appendMessage, getOrStartSession } from "../../services/sessions";
import { getSkill, type SkillContext } from "..";

const db = getTestDb();
let tools: ReturnType<ReturnType<typeof getSkill>["tools"]>;
beforeEach(async () => {
  await resetDb(db);
  await seedUser(db, "u1");
  const pc = await seedProvider(db, "u1");
  const s = await getOrStartSession(db, "u1");
  const { id } = await appendMessage(db, "u1", s.id, {
    role: "assistant",
    parts: [],
    status: "interrupted",
  });
  const ctx: SkillContext = {
    deps: testDeps(db),
    llm: fakeLlm({ userId: "u1", providerConfigId: pc, models: {} }),
    userId: "u1",
    sessionId: s.id,
    messageId: id,
    timezone: "UTC",
  };
  tools = getSkill("planning").tools(ctx);
});
const draft = {
  northStar: "Become a registered nurse",
  milestones: [{ title: "Finish prerequisites" }],
  actions: [{ title: "Email two colleges", milestoneIndex: 0 }],
};
const emptyChange = {
  milestones: { add: [], update: [], remove: [] },
  actions: { add: [], update: [], remove: [] },
};

it("getPlan reports when there is no plan", async () =>
  expect(await runTool(tools, "getPlan", {})).toEqual({ plan: null }));

it("getPlan omits actions older than last week", async () => {
  const thisWeek = mondayOf(new Date(), "UTC");
  const lastWeek = mondayOf(new Date(Date.now() - 7 * 86400_000), "UTC");
  const old = mondayOf(new Date(Date.now() - 21 * 86400_000), "UTC");
  await createPlan(db, "u1", {
    northStar: "RN",
    milestones: [{ title: "M" }],
    actions: [
      { title: "old", weekOf: old },
      { title: "last", weekOf: lastWeek },
      { title: "now", weekOf: thisWeek },
    ],
  });
  const { plan } = (await runTool(tools, "getPlan", {})) as {
    plan: { northStar: string; actions: { title: string }[]; milestones: { id: string }[] };
  };
  expect(plan.northStar).toBe("RN");
  expect(plan.milestones).toHaveLength(1);
  expect(plan.actions.map((a) => a.title).sort()).toEqual(["last", "now"]);
});

it("proposePlan defaults actions to this week's Monday", async () => {
  await runTool(tools, "proposePlan", draft);
  const [p] = await listProposals(db, "u1");
  expect(p).toMatchObject({
    kind: "plan_create",
    payload: {
      northStar: "Become a registered nurse",
      actions: [{ title: "Email two colleges", weekOf: mondayOf(new Date(), "UTC") }],
    },
  });
});

it("proposePlan rejects a weekOf that is not a Monday", async () =>
  await expect(
    runTool(tools, "proposePlan", { ...draft, actions: [{ title: "x", weekOf: "2026-10-14" }] }),
  ).rejects.toThrow("weekOf must be a Monday (YYYY-MM-DD)."));

it("proposePlanChange needs an active plan and known ids", async () => {
  const change = {
    ...emptyChange,
    actions: { add: [{ title: "Book a shadowing day" }], update: [], remove: [] },
  };
  await expect(runTool(tools, "proposePlanChange", change)).rejects.toThrow(
    "There is no active plan yet. Use proposePlan to create one.",
  );
  await createPlan(db, "u1", {
    northStar: "RN",
    milestones: [{ title: "M" }],
    actions: [{ title: "A", weekOf: mondayOf(new Date(), "UTC") }],
  });
  const ghost = crypto.randomUUID();
  await expect(
    runTool(tools, "proposePlanChange", {
      ...change,
      actions: { ...change.actions, remove: [ghost] },
    }),
  ).rejects.toThrow(`Unknown milestone or action ids: ${ghost}`);
  await runTool(tools, "proposePlanChange", change);
  const [p] = await listProposals(db, "u1");
  expect(p).toMatchObject({
    kind: "plan_change",
    payload: { actions: { add: [{ weekOf: mondayOf(new Date(), "UTC") }] } },
  });
});

it("proposePlanChange rejects a non-Monday weekOf on added and updated actions", async () => {
  const plan = await createPlan(db, "u1", {
    northStar: "RN",
    milestones: [{ title: "M" }],
    actions: [{ title: "A", weekOf: mondayOf(new Date(), "UTC") }],
  });
  const bad = "2026-10-14";
  await expect(
    runTool(tools, "proposePlanChange", {
      ...emptyChange,
      actions: { add: [{ title: "x", weekOf: bad }], update: [], remove: [] },
    }),
  ).rejects.toThrow("weekOf must be a Monday (YYYY-MM-DD).");
  await expect(
    runTool(tools, "proposePlanChange", {
      ...emptyChange,
      actions: {
        add: [],
        update: [{ id: plan.actions[0]?.id, weekOf: bad }],
        remove: [],
      },
    }),
  ).rejects.toThrow("weekOf must be a Monday (YYYY-MM-DD).");
});
