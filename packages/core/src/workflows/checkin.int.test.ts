import { beforeEach, describe, expect, it } from "vitest";
import { getTestDb, resetDb } from "../../../../test/integration/db";
import { seedProvider, seedUser, workflowDeps } from "../../../../test/integration/fixtures";
import { registerMockFixture } from "../llm";
import { createScheduledCheckin, getCheckin } from "../services/checkins";
import { listMemory } from "../services/memory";
import { createPlan, setActionStatus } from "../services/plan";
import { getOrStartSession } from "../services/sessions";
import { advance, CHECKIN_OPENERS, replanGoal, startWorkflow, stepMessages } from ".";

const db = getTestDb();
const deps = workflowDeps(db);
const WEEK = "2026-10-12";
let checkinId: string;
const text = (m: { parts: { type: string; text?: string }[] }) =>
  m.parts.map((p) => p.text ?? "").join("");
async function toEnergy() {
  const run = await startWorkflow(deps, "u1", "checkin", { checkinId, weekOf: WEEK });
  for (const stepId of ["wins", "action_review", "blockers"])
    await advance(deps, "u1", run.id, { stepId, skip: true });
  return run;
}

beforeEach(async () => {
  await resetDb(db);
  await seedUser(db, "u1");
  await seedProvider(db, "u1");
  const plan = await createPlan(db, "u1", {
    northStar: "Move into health data",
    milestones: [],
    actions: [
      { title: "Book a call", weekOf: WEEK },
      { title: "Update CV", weekOf: WEEK },
    ],
  });
  await setActionStatus(db, "u1", plan.actions[0]!.id, "done");
  checkinId = (await createScheduledCheckin(db, "u1", {
    weekOf: WEEK,
    dueAt: new Date("2026-10-18T18:00:00Z"),
  }))!.id;
  registerMockFixture("checkin.summarize", () => ({
    json: {
      summary: "Steady week.",
      memories: [
        { category: "drain", content: "Night shifts drain me", sensitive: false },
        { category: "fact", content: "Started therapy", sensitive: true },
      ],
    },
  }));
});

describe("check-in workflow", () => {
  it("prepare captures the week and opens with wins", async () => {
    const run = await startWorkflow(deps, "u1", "checkin", { checkinId, weekOf: WEEK });
    expect(run.stepId).toBe("wins");
    expect(run.state.week).toMatchObject({
      weekOf: WEEK,
      done: [{ title: "Book a call" }],
      remaining: [{ title: "Update CV" }],
    });
    expect((await stepMessages(db, "u1", run)).map(text)).toEqual([CHECKIN_OPENERS.wins]);
  });
  it("saves energy on the check-in; 1–2 caps the replan at 2 actions", async () => {
    const run = await toEnergy();
    await expect(
      advance(deps, "u1", run.id, { stepId: "energy", uiResult: { energy: 6 } }),
    ).rejects.toThrow();
    const r = await advance(deps, "u1", run.id, {
      stepId: "energy",
      uiResult: { energy: 2, note: "Tired" },
    });
    expect(r).toMatchObject({ stepId: "replan", state: { energy: 2, energyNote: "Tired" } });
    expect((await getCheckin(db, "u1", checkinId)).energy).toBe(2);
    expect((await stepMessages(db, "u1", r)).map(text)).toEqual([CHECKIN_OPENERS.replanLow]);
    expect(replanGoal({ energy: 2 })).toMatch(/at most 2 new actions/);
    expect(replanGoal({ energy: 4 })).not.toMatch(/at most/);
  });
  it("summarize saves to the session, to memory, and completes the check-in", async () => {
    const run = await toEnergy();
    await advance(deps, "u1", run.id, { stepId: "energy", uiResult: { energy: 4 } });
    const done = await advance(deps, "u1", run.id, { stepId: "replan", skip: true });
    expect(done.status).toBe("completed");
    expect(await getCheckin(db, "u1", checkinId)).toMatchObject({
      status: "completed",
      summary: "Steady week.",
    });
    expect((await getOrStartSession(db, "u1", { workflowRunId: run.id })).summary).toBe(
      "Steady week.",
    );
    expect(
      (await listMemory(db, "u1", { status: ["active", "pending"] }))
        .map((m) => [m.category, m.content, m.status, m.sourceType])
        .sort(),
    ).toEqual([
      ["drain", "Night shifts drain me", "active", "checkin"],
      ["event", `Check-in (week of ${WEEK}): Steady week.`, "active", "checkin"],
      ["fact", "Started therapy", "pending", "checkin"],
    ]);
  });
  it("'Do it manually' on a failed summary still completes the check-in", async () => {
    registerMockFixture("checkin.summarize", () => {
      throw new Error("down");
    });
    const run = await toEnergy();
    await advance(deps, "u1", run.id, { stepId: "energy", uiResult: { energy: 3 } });
    expect(await advance(deps, "u1", run.id, { stepId: "replan", skip: true })).toMatchObject({
      stepId: "summarize",
      status: "needs_attention",
    });
    expect((await advance(deps, "u1", run.id, { stepId: "summarize", skip: true })).status).toBe(
      "completed",
    );
    expect(await getCheckin(db, "u1", checkinId)).toMatchObject({
      status: "completed",
      summary: null,
    });
  });
});
