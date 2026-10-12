import type { PgBoss } from "pg-boss";
import type { z } from "zod";
import type { JobDeps } from "./queue";

export interface JobDefinition<T> {
  name: string;
  schema: z.ZodType<T>;
  handler(deps: JobDeps, data: T): Promise<void>;
  cron?: string;
  /** "stately" = at most one queued and one active job per singletonKey; pg-boss ignores singletonKey on "standard" queues. */
  policy?: "standard" | "stately";
}

// biome-ignore lint/suspicious/noExplicitAny: a heterogeneous list of definitions with differing payload types
export type AnyJobDefinition = JobDefinition<any>;

/** Idempotent: creates `<name>.dead` and `<name>` (or updates the retry settings of an existing queue). */
export async function ensureQueues(boss: PgBoss, defs: AnyJobDefinition[]): Promise<void> {
  for (const def of defs) {
    const deadLetter = `${def.name}.dead`;
    if (!(await boss.getQueue(deadLetter))) await boss.createQueue(deadLetter);
    const settings = { retryLimit: 3, retryBackoff: true, deadLetter };
    if (await boss.getQueue(def.name)) {
      await boss.updateQueue(def.name, settings);
    } else {
      await boss.createQueue(def.name, { policy: def.policy ?? "standard", ...settings });
    }
  }
}

export async function registerJobs(
  boss: PgBoss,
  deps: JobDeps,
  defs: AnyJobDefinition[],
): Promise<void> {
  await ensureQueues(boss, defs);
  for (const def of defs) {
    await boss.work(def.name, async (jobs) => {
      for (const job of jobs) {
        // A schedule or send without data yields null; an invalid payload throws and dead-letters.
        await def.handler(deps, def.schema.parse(job.data ?? {}));
      }
    });
    // `{}` data: a data-less schedule would deliver null.
    if (def.cron) await boss.schedule(def.name, def.cron, {});
  }
}
