import type { PgBoss } from "pg-boss";

export const DEAD_LETTER_SUFFIX = ".dead";

export interface QueueHealth {
  name: string;
  queued: number;
  active: number;
  failed: number;
  deadLettered: number;
}

export interface DeadLetterRef {
  queue: string;
  id: string;
}

export interface DeadLetterJob extends DeadLetterRef {
  sourceQueue: string;
  createdOn: Date;
  deadLetteredOn: Date;
  lastError: string | null;
  userId: string | null;
}

export interface JobAdmin {
  queueHealth(): Promise<QueueHealth[]>;
  listDeadLetters(limit?: number): Promise<DeadLetterJob[]>;
  retryDeadLetter(ref: DeadLetterRef): Promise<boolean>;
  discardDeadLetter(ref: DeadLetterRef): Promise<boolean>;
  cancelUserJobs(userId: string): Promise<number>;
}

// pg-boss 12.37.1 declares CommandResponse as empty; manager.mapCommandResponse
// returns this count for deleteJob/cancel. Integration tests exercise both results.
type CommandCount = { affected: number };

const isDeadLetter = (name: string) => name.endsWith(DEAD_LETTER_SUFFIX);
const sourceName = (name: string) => name.slice(0, -DEAD_LETTER_SUFFIX.length);
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export function pgBossJobAdmin(boss: PgBoss): JobAdmin {
  const queues = async () => (await boss.getQueues()).filter((q) => !q.name.startsWith("__"));
  const validDeadLetter = async (name: string) => {
    if (!isDeadLetter(name)) return false;
    const all = await queues();
    return (
      all.some((q) => q.name === name) &&
      all.some((q) => q.name === sourceName(name) && q.deadLetter === name)
    );
  };

  return {
    async queueHealth() {
      const all = await queues();
      const names = new Set(all.map((q) => q.name));
      return Promise.all(
        all
          .filter((q) => !isDeadLetter(q.name))
          .sort((a, b) => a.name.localeCompare(b.name))
          .map(async (q) => {
            const [stats] = await boss.getQueueStats(q.name, { force: true });
            const dead = `${q.name}${DEAD_LETTER_SUFFIX}`;
            const [deadStats] = names.has(dead)
              ? await boss.getQueueStats(dead, { force: true })
              : [];
            return {
              name: q.name,
              queued: stats?.queuedCount ?? 0,
              active: stats?.activeCount ?? 0,
              failed: stats?.failedCount ?? 0,
              deadLettered: deadStats?.queuedCount ?? 0,
            };
          }),
      );
    },
    async listDeadLetters(limit = 50) {
      const all = await queues();
      const letters = (
        await Promise.all(
          all
            .filter((q) => isDeadLetter(q.name))
            .map(async (q) => {
              const jobs = await boss.findJobs<unknown>(q.name, { queued: true });
              return jobs.map(
                (job): DeadLetterJob => ({
                  id: job.id,
                  queue: q.name,
                  sourceQueue: job.sourceName ?? sourceName(q.name),
                  createdOn: job.sourceCreatedOn ?? job.createdOn,
                  deadLetteredOn: job.createdOn,
                  lastError:
                    isObject(job.sourceOutput) && typeof job.sourceOutput.message === "string"
                      ? job.sourceOutput.message.slice(0, 300)
                      : null,
                  userId:
                    isObject(job.data) && typeof job.data.userId === "string"
                      ? job.data.userId
                      : null,
                }),
              );
            }),
        )
      ).flat();
      return letters
        .sort((a, b) => b.deadLetteredOn.getTime() - a.deadLetteredOn.getTime())
        .slice(0, limit);
    },
    async retryDeadLetter(ref) {
      if (!(await validDeadLetter(ref.queue))) return false;
      return (await boss.redrive(ref.queue, { ids: [ref.id] })) > 0;
    },
    async discardDeadLetter(ref) {
      if (!(await validDeadLetter(ref.queue))) return false;
      return ((await boss.deleteJob(ref.queue, ref.id)) as CommandCount).affected > 0;
    },
    async cancelUserJobs(userId) {
      let cancelled = 0;
      for (const q of await queues()) {
        const source = isDeadLetter(q.name) ? sourceName(q.name) : q.name;
        if (source === "maintenance.tick" || source === "checkin.dispatch") continue;
        const pending = await boss.findJobs(q.name, { data: { userId }, queued: true });
        if (pending.length === 0) continue;
        const ids = pending.map((job) => job.id);
        const result = isDeadLetter(q.name)
          ? await boss.deleteJob(q.name, ids)
          : await boss.cancel(q.name, ids);
        cancelled += (result as CommandCount).affected;
      }
      return cancelled;
    },
  };
}
