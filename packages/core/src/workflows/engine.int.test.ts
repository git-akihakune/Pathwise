import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { getTestDb, resetDb } from "../../../../test/integration/db";
import { seedUser, workflowDeps } from "../../../../test/integration/fixtures";
import { schema } from "../db";
import { NotFoundError } from "../errors";
import { createWorkflowEngine } from "./engine";
import type { WorkflowDefinition } from "./types";

const db = getTestDb();
const deps = workflowDeps(db);
let calls: { c: number; apply: number; complete: number };
let failC: boolean;
const toy: WorkflowDefinition = {
  type: "onboarding",
  steps: [
    { kind: "compute", id: "a", manualHint: "", run: async () => ({ state: { a: 1 } }) },
    {
      kind: "ui",
      id: "b",
      input: z.object({ n: z.number() }),
      apply: async (_ctx, r) => {
        calls.apply++;
        return { state: { b: (r as { n: number }).n } };
      },
    },
    {
      kind: "compute",
      id: "c",
      manualHint: "Skip c",
      run: async () => {
        calls.c++;
        if (failC) throw new Error("boom");
        return { state: { c: true } };
      },
    },
    { kind: "ui", id: "d", input: z.object({}), skipWhen: (s) => s.skipD === true },
  ],
  onComplete: async () => {
    calls.complete++;
  },
};
const engine = createWorkflowEngine({ onboarding: toy });
const setRun = (id: string, patch: Partial<typeof schema.workflowRuns.$inferInsert>) =>
  db.update(schema.workflowRuns).set(patch).where(eq(schema.workflowRuns.id, id));

beforeEach(async () => {
  await resetDb(db);
  await seedUser(db, "u1");
  await seedUser(db, "u2");
  calls = { c: 0, apply: 0, complete: 0 };
  failC = false;
});

describe("workflow engine", () => {
  it("runs leading compute steps and stops at the first ui step", async () => {
    const run = await engine.startWorkflow(deps, "u1", "onboarding");
    expect(run).toMatchObject({ stepId: "b", status: "active", state: { a: 1 } });
    expect(run.state.steps?.a?.status).toBe("done");
  });
  it("keeps one open run per user and type, even under concurrency", async () => {
    const [r1, r2] = await Promise.all([
      engine.startWorkflow(deps, "u1", "onboarding"),
      engine.startWorkflow(deps, "u1", "onboarding"),
    ]);
    expect(r1.id).toBe(r2.id);
    expect(await db.$count(schema.workflowRuns)).toBe(1);
  });
  it("rejects invalid ui input and stays on the step", async () => {
    const run = await engine.startWorkflow(deps, "u1", "onboarding");
    await expect(
      engine.advance(deps, "u1", run.id, { stepId: "b", uiResult: { n: "x" } }),
    ).rejects.toThrow();
    expect((await engine.getRun(db, "u1", run.id)).stepId).toBe("b");
  });
  it("tries a failing compute step 3 times, then needs attention; Retry re-runs it", async () => {
    failC = true;
    const run = await engine.startWorkflow(deps, "u1", "onboarding");
    const r = await engine.advance(deps, "u1", run.id, { stepId: "b", uiResult: { n: 2 } });
    expect(r).toMatchObject({
      stepId: "c",
      status: "needs_attention",
      state: { b: 2, attention: { stepId: "c" } },
    });
    expect(calls.c).toBe(3);
    failC = false;
    const retried = await engine.retryStep(deps, "u1", run.id);
    expect(retried).toMatchObject({ stepId: "d", status: "active", state: { c: true } });
    expect(retried.state.attention).toBeUndefined();
  });
  it("'Do it manually' skips the failed step and can complete the run", async () => {
    failC = true;
    const run = await engine.startWorkflow(deps, "u1", "onboarding", { skipD: true });
    await engine.advance(deps, "u1", run.id, { stepId: "b", uiResult: { n: 2 } });
    const r = await engine.advance(deps, "u1", run.id, { stepId: "c", skip: true });
    expect(r.status).toBe("completed");
    expect(r.completedAt).toBeInstanceOf(Date);
    expect(r.state.steps?.c?.status).toBe("skipped");
    expect(r.state.steps?.d?.status).toBe("skipped");
    expect(calls.complete).toBe(1);
  });
  it("applies a double-submitted ui step once (Review Focus 4)", async () => {
    const run = await engine.startWorkflow(deps, "u1", "onboarding");
    const input = { stepId: "b", uiResult: { n: 5 } };
    await Promise.all([
      engine.advance(deps, "u1", run.id, input),
      engine.advance(deps, "u1", run.id, input),
    ]);
    expect(calls.apply).toBe(1);
    expect(calls.c).toBe(1);
    expect((await engine.getRun(db, "u1", run.id)).stepId).toBe("d");
  });
  it("ignores a stale submit for a step that already passed (Review Focus 4)", async () => {
    const run = await engine.startWorkflow(deps, "u1", "onboarding");
    await engine.advance(deps, "u1", run.id, { stepId: "b", uiResult: { n: 1 } });
    const r = await engine.advance(deps, "u1", run.id, { stepId: "b", skip: true });
    expect(r.stepId).toBe("d");
    expect(r.state.steps?.d).toBeUndefined();
  });
  it("resumes a compute step whose runner died, but not one still leased (Review Focus 4)", async () => {
    const run = await engine.startWorkflow(deps, "u1", "onboarding");
    await setRun(run.id, { stepId: "c", runningSince: new Date(Date.now() - 60_000) });
    expect((await engine.advance(deps, "u1", run.id)).stepId).toBe("c");
    expect(calls.c).toBe(0);
    await setRun(run.id, { runningSince: new Date(Date.now() - 6 * 60_000) });
    expect((await engine.advance(deps, "u1", run.id)).stepId).toBe("d");
    expect(calls.c).toBe(1);
  });
  it("scopes runs to their owner and allows a fresh run after abandoning", async () => {
    const run = await engine.startWorkflow(deps, "u1", "onboarding");
    await expect(
      engine.advance(deps, "u2", run.id, { stepId: "b", skip: true }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await engine.abandonRun(db, "u1", run.id);
    expect(await engine.getActiveRun(db, "u1", "onboarding")).toBeNull();
    expect((await engine.startWorkflow(deps, "u1", "onboarding")).id).not.toBe(run.id);
  });
  it("returns the latest run of a type, finished or not", async () => {
    expect(await engine.latestRun(db, "u1", "onboarding")).toBeNull();
    const run = await engine.startWorkflow(deps, "u1", "onboarding");
    await engine.abandonRun(db, "u1", run.id);
    expect((await engine.latestRun(db, "u1", "onboarding"))?.status).toBe("abandoned");
  });
});
