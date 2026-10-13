import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { type DbOrTx, schema } from "../db";
import { LlmUnavailableError, NotFoundError } from "../errors";
import { isAuthError, isProviderError, StructuredOutputError } from "../llm";
import { createLogger } from "../logger";
import {
  ATTENTION_MESSAGES,
  COMPUTE_ATTEMPTS,
  COMPUTE_LEASE_MS,
  type RunState,
  type Step,
  type StepRecord,
  type StepResult,
  type WorkflowDefinition,
  type WorkflowDeps,
  type WorkflowRun,
  type WorkflowType,
} from "./types";

const { workflowRuns } = schema;
const log = createLogger("workflow");
const OPEN = ["active", "needs_attention"] as const;

type RunRow = typeof workflowRuns.$inferSelect;

function toRun(r: RunRow): WorkflowRun {
  return {
    id: r.id,
    type: r.type as WorkflowType,
    stepId: r.stepId,
    state: r.state as RunState,
    status: r.status as WorkflowRun["status"],
    createdAt: r.createdAt,
    completedAt: r.completedAt,
  };
}

/** The next step after `fromStepId` (null = before the first) that `skipWhen` doesn't skip. */
export function resolveNextStep(
  def: WorkflowDefinition,
  fromStepId: string | null,
  state: RunState,
): { stepId: string | null; skipped: string[] } {
  let i = 0;
  if (fromStepId !== null) {
    const at = def.steps.findIndex((s) => s.id === fromStepId);
    if (at < 0) throw new Error(`unknown step: ${fromStepId}`);
    i = at + 1;
  }
  const skipped: string[] = [];
  for (; i < def.steps.length; i++) {
    const step = def.steps[i] as Step;
    if (step.skipWhen?.(state)) skipped.push(step.id);
    else return { stepId: step.id, skipped };
  }
  return { stepId: null, skipped };
}

function record(state: RunState, stepId: string, rec: Omit<StepRecord, "at">): RunState {
  return {
    ...state,
    steps: { ...state.steps, [stepId]: { ...rec, at: new Date().toISOString() } },
  };
}

function withSkips(state: RunState, skipped: string[]): RunState {
  return skipped.reduce((s, id) => record(s, id, { status: "skipped" }), state);
}

function withoutAttention(state: RunState): RunState {
  const { attention: _a, ...rest } = state;
  return rest;
}

function attentionMessage(e: unknown): string {
  if (isAuthError(e)) return ATTENTION_MESSAGES.auth;
  if (e instanceof LlmUnavailableError) {
    return e.reason === "auth_failed" ? ATTENTION_MESSAGES.auth : ATTENTION_MESSAGES.noProvider;
  }
  if (e instanceof StructuredOutputError) return ATTENTION_MESSAGES.format;
  if (isProviderError(e)) return ATTENTION_MESSAGES.provider;
  return ATTENTION_MESSAGES.unknown;
}

export interface WorkflowEngine {
  startWorkflow(
    deps: WorkflowDeps,
    userId: string,
    type: WorkflowType,
    initialState?: Record<string, unknown>,
  ): Promise<WorkflowRun>;
  getActiveRun(db: DbOrTx, userId: string, type: WorkflowType): Promise<WorkflowRun | null>;
  getRun(db: DbOrTx, userId: string, runId: string): Promise<WorkflowRun>;
  latestRun(db: DbOrTx, userId: string, type: WorkflowType): Promise<WorkflowRun | null>;
  advance(
    deps: WorkflowDeps,
    userId: string,
    runId: string,
    input?: { stepId?: string; uiResult?: unknown; skip?: boolean },
  ): Promise<WorkflowRun>;
  retryStep(deps: WorkflowDeps, userId: string, runId: string): Promise<WorkflowRun>;
  abandonRun(db: DbOrTx, userId: string, runId: string): Promise<void>;
}

export function createWorkflowEngine(
  defs: Partial<Record<WorkflowType, WorkflowDefinition>>,
): WorkflowEngine {
  const defOf = (type: WorkflowType): WorkflowDefinition => {
    const def = defs[type];
    if (!def) throw new Error(`No workflow definition for ${type}`);
    return def;
  };
  const stepOf = (def: WorkflowDefinition, id: string): Step => {
    const step = def.steps.find((s) => s.id === id);
    if (!step) throw new Error(`unknown step: ${id}`);
    return step;
  };

  async function load(db: DbOrTx, userId: string, runId: string): Promise<RunRow> {
    const [row] = await db
      .select()
      .from(workflowRuns)
      .where(and(eq(workflowRuns.id, runId), eq(workflowRuns.userId, userId)));
    if (!row) throw new NotFoundError("Workflow run not found.");
    return row;
  }

  /** Where `where` pins the run to the step and status that were read. */
  const unchanged = (cur: WorkflowRun) =>
    and(
      eq(workflowRuns.id, cur.id),
      eq(workflowRuns.stepId, cur.stepId),
      eq(workflowRuns.status, cur.status),
    );

  async function reread(db: DbOrTx, userId: string, runId: string): Promise<WorkflowRun> {
    return toRun(await load(db, userId, runId));
  }

  /**
   * `cur`'s step is finished with `state`: move to the next step, or complete the run (running
   * `onComplete` in the same transaction). Null when someone else already moved the run.
   */
  async function moveOn(
    deps: WorkflowDeps,
    db: DbOrTx,
    userId: string,
    def: WorkflowDefinition,
    cur: WorkflowRun,
    state: RunState,
  ): Promise<WorkflowRun | null> {
    const next = resolveNextStep(def, cur.stepId, state);
    const nextState = withSkips(withoutAttention(state), next.skipped);
    if (next.stepId !== null) {
      const [row] = await db
        .update(workflowRuns)
        .set({
          stepId: next.stepId,
          state: nextState,
          status: "active",
          runningSince: null,
          updatedAt: sql`now()`,
        })
        .where(unchanged(cur))
        .returning();
      return row ? toRun(row) : null;
    }
    return db.transaction(async (tx) => {
      const [row] = await tx
        .update(workflowRuns)
        .set({
          state: nextState,
          status: "completed",
          completedAt: sql`now()`,
          runningSince: null,
          updatedAt: sql`now()`,
        })
        .where(unchanged(cur))
        .returning();
      if (!row) return null;
      const run = toRun(row);
      await def.onComplete?.({ deps, db: tx, userId, run });
      log.info({ runId: run.id, type: run.type, stepId: run.stepId, outcome: "completed" });
      return run;
    });
  }

  /** Runs compute steps until a step that needs the user (or a failure) is reached. */
  async function enterStep(
    deps: WorkflowDeps,
    userId: string,
    def: WorkflowDefinition,
    start: WorkflowRun,
  ): Promise<WorkflowRun> {
    let cur = start;
    for (;;) {
      if (cur.status !== "active") return cur;
      const step = stepOf(def, cur.stepId);
      if (step.kind !== "compute") return cur;

      const [claimed] = await deps.db
        .update(workflowRuns)
        .set({ runningSince: sql`now()`, updatedAt: sql`now()` })
        .where(
          and(
            eq(workflowRuns.id, cur.id),
            eq(workflowRuns.stepId, cur.stepId),
            eq(workflowRuns.status, "active"),
            sql`(${workflowRuns.runningSince} is null or ${workflowRuns.runningSince} < now() - ${COMPUTE_LEASE_MS / 1000} * interval '1 second')`,
          ),
        )
        .returning();
      if (!claimed) return reread(deps.db, userId, cur.id);
      cur = toRun(claimed);

      let result: StepResult | undefined;
      let failure: unknown;
      for (let attempt = 1; attempt <= COMPUTE_ATTEMPTS; attempt++) {
        try {
          result = await step.run({ deps, db: deps.db, userId, run: cur });
          failure = undefined;
          break;
        } catch (e) {
          failure = e;
          log.warn({ runId: cur.id, type: cur.type, stepId: step.id, attempt, outcome: "error" });
          if (isAuthError(e) || e instanceof LlmUnavailableError) break;
        }
      }

      if (!result) {
        const [row] = await deps.db
          .update(workflowRuns)
          .set({
            status: "needs_attention",
            state: {
              ...cur.state,
              attention: { stepId: step.id, message: attentionMessage(failure) },
            },
            runningSince: null,
            updatedAt: sql`now()`,
          })
          .where(unchanged(cur))
          .returning();
        log.info({ runId: cur.id, type: cur.type, stepId: step.id, outcome: "needs_attention" });
        return row ? toRun(row) : reread(deps.db, userId, cur.id);
      }

      const merged: RunState = { ...cur.state, ...result.state };
      if (result.wait) {
        const [row] = await deps.db
          .update(workflowRuns)
          .set({ state: merged, runningSince: null, updatedAt: sql`now()` })
          .where(unchanged(cur))
          .returning();
        return row ? toRun(row) : reread(deps.db, userId, cur.id);
      }
      const moved = await moveOn(
        deps,
        deps.db,
        userId,
        def,
        cur,
        record(merged, step.id, { status: "done" }),
      );
      if (!moved) return reread(deps.db, userId, cur.id);
      log.info({ runId: cur.id, type: cur.type, stepId: step.id, outcome: "done" });
      cur = moved;
    }
  }

  const getActiveRun: WorkflowEngine["getActiveRun"] = async (db, userId, type) => {
    const [row] = await db
      .select()
      .from(workflowRuns)
      .where(
        and(
          eq(workflowRuns.userId, userId),
          eq(workflowRuns.type, type),
          inArray(workflowRuns.status, [...OPEN]),
        ),
      );
    return row ? toRun(row) : null;
  };

  return {
    getActiveRun,
    getRun: (db, userId, runId) => reread(db, userId, runId),

    async latestRun(db, userId, type) {
      const [row] = await db
        .select()
        .from(workflowRuns)
        .where(and(eq(workflowRuns.userId, userId), eq(workflowRuns.type, type)))
        .orderBy(desc(workflowRuns.createdAt), desc(workflowRuns.id))
        .limit(1);
      return row ? toRun(row) : null;
    },

    async startWorkflow(deps, userId, type, initialState = {}) {
      const def = defOf(type);
      const open = await getActiveRun(deps.db, userId, type);
      if (open) return open;
      const first = resolveNextStep(def, null, initialState);
      const [row] = await deps.db
        .insert(workflowRuns)
        .values({
          userId,
          type,
          stepId: first.stepId ?? (def.steps[0] as Step).id,
          state: withSkips(initialState, first.skipped),
        })
        .onConflictDoNothing()
        .returning();
      if (!row) {
        const winner = await getActiveRun(deps.db, userId, type);
        if (winner) return winner;
        throw new Error("Could not start the workflow.");
      }
      log.info({ runId: row.id, type, stepId: row.stepId, outcome: "started" });
      let run = toRun(row);
      if (first.stepId === null) {
        const done = await moveOn(deps, deps.db, userId, def, run, run.state);
        return done ?? reread(deps.db, userId, run.id);
      }
      run = await enterStep(deps, userId, def, run);
      return run;
    },

    async advance(deps, userId, runId, input = {}) {
      const row = await load(deps.db, userId, runId);
      const run = toRun(row);
      const def = defOf(run.type);
      if (run.status === "completed" || run.status === "abandoned") return run;
      if (input.stepId !== undefined && input.stepId !== run.stepId) return run;

      if (input.skip) {
        const moved = await deps.db.transaction(async (tx) => {
          const [locked] = await tx
            .select()
            .from(workflowRuns)
            .where(and(eq(workflowRuns.id, runId), eq(workflowRuns.userId, userId)))
            .for("update");
          const cur = locked && toRun(locked);
          if (
            !cur ||
            cur.stepId !== run.stepId ||
            !(OPEN as readonly string[]).includes(cur.status)
          ) {
            return null;
          }
          return moveOn(
            deps,
            tx,
            userId,
            def,
            cur,
            record(cur.state, cur.stepId, { status: "skipped" }),
          );
        });
        return moved ? enterStep(deps, userId, def, moved) : reread(deps.db, userId, runId);
      }

      const step = stepOf(def, run.stepId);
      if (step.kind === "ui" && input.uiResult !== undefined) {
        const moved = await deps.db.transaction(async (tx) => {
          const [locked] = await tx
            .select()
            .from(workflowRuns)
            .where(and(eq(workflowRuns.id, runId), eq(workflowRuns.userId, userId)))
            .for("update");
          const cur = locked && toRun(locked);
          if (!cur || cur.stepId !== step.id || cur.status !== "active") return null;
          const parsed = step.input.parse(input.uiResult);
          const result = await step.apply?.({ deps, db: tx, userId, run: cur }, parsed);
          const state = record({ ...cur.state, ...result?.state }, step.id, { status: "done" });
          return moveOn(deps, tx, userId, def, cur, state);
        });
        return moved ? enterStep(deps, userId, def, moved) : reread(deps.db, userId, runId);
      }
      if (step.kind === "compute" && input.uiResult === undefined) {
        return enterStep(deps, userId, def, run);
      }
      return run;
    },

    async retryStep(deps, userId, runId) {
      const run = await reread(deps.db, userId, runId);
      if (run.status !== "needs_attention") return run;
      const [row] = await deps.db
        .update(workflowRuns)
        .set({
          status: "active",
          state: withoutAttention(run.state),
          runningSince: null,
          updatedAt: sql`now()`,
        })
        .where(unchanged(run))
        .returning();
      if (!row) return reread(deps.db, userId, runId);
      return enterStep(deps, userId, defOf(run.type), toRun(row));
    },

    async abandonRun(db, userId, runId) {
      await load(db, userId, runId);
      await db
        .update(workflowRuns)
        .set({ status: "abandoned", runningSince: null, updatedAt: sql`now()` })
        .where(and(eq(workflowRuns.id, runId), inArray(workflowRuns.status, [...OPEN])));
    },
  };
}
