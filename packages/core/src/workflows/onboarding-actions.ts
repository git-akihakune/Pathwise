import { and, eq, sql } from "drizzle-orm";
import { type DbOrTx, schema } from "../db";
import { getDocument } from "../services/documents";
import { abandonRun, advance, getActiveRun, latestRun } from "./instance";
import type { WorkflowDeps, WorkflowRun } from "./types";

const { workflowRuns } = schema;

export type OnboardingState = "not_started" | "in_progress" | "skipped" | "completed";

/** Attaches an uploaded document to the run's ingest step and re-runs it. */
export async function attachOnboardingDocument(
  deps: WorkflowDeps,
  userId: string,
  runId: string,
  documentId: string,
): Promise<WorkflowRun> {
  await getDocument(deps.db, userId, documentId);
  await deps.db
    .update(workflowRuns)
    .set({
      state: sql`${workflowRuns.state} || jsonb_build_object('documentId', ${documentId}::text)`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(workflowRuns.id, runId),
        eq(workflowRuns.userId, userId),
        eq(workflowRuns.stepId, "ingest"),
        eq(workflowRuns.status, "active"),
      ),
    );
  return advance(deps, userId, runId, { stepId: "ingest" });
}

export async function getOnboardingState(db: DbOrTx, userId: string): Promise<OnboardingState> {
  const run = await latestRun(db, userId, "onboarding");
  if (!run) return "not_started";
  if (run.status === "completed") return "completed";
  return run.status === "abandoned" ? "skipped" : "in_progress";
}

/** Abandons the open run, or records an abandoned one so Today stops asking. */
export async function skipOnboarding(deps: WorkflowDeps, userId: string): Promise<void> {
  const open = await getActiveRun(deps.db, userId, "onboarding");
  if (open) return abandonRun(deps.db, userId, open.id);
  await deps.db
    .insert(workflowRuns)
    .values({ userId, type: "onboarding", stepId: "provider_check", status: "abandoned" });
}

/** For seeded users (Plan 6's demo): a completed run, unless one exists. */
export async function recordCompletedOnboarding(db: DbOrTx, userId: string): Promise<void> {
  const [done] = await db
    .select({ id: workflowRuns.id })
    .from(workflowRuns)
    .where(
      and(
        eq(workflowRuns.userId, userId),
        eq(workflowRuns.type, "onboarding"),
        eq(workflowRuns.status, "completed"),
      ),
    )
    .limit(1);
  if (done) return;
  await db.insert(workflowRuns).values({
    userId,
    type: "onboarding",
    stepId: "confirm",
    status: "completed",
    completedAt: new Date(),
    state: {},
  });
}
