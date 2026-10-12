import type { PgBoss } from "pg-boss";
import type { LlmDeps } from "../llm/types";

export const JOBS = {
  sessionCurate: "session.curate",
  sessionSummarize: "session.summarize",
  memoryEmbed: "memory.embed",
  snapshotRefresh: "snapshot.refresh",
  maintenanceTick: "maintenance.tick",
} as const;

export interface JobQueue {
  send(
    name: string,
    data: object,
    opts?: { startAfterSeconds?: number; singletonKey?: string },
  ): Promise<void>;
}

export interface JobDeps extends LlmDeps {
  queue: JobQueue;
}

export function pgBossQueue(boss: PgBoss): JobQueue {
  return {
    async send(name, data, opts) {
      await boss.send(name, data, {
        ...(opts?.startAfterSeconds !== undefined && { startAfter: opts.startAfterSeconds }),
        ...(opts?.singletonKey !== undefined && { singletonKey: opts.singletonKey }),
      });
    },
  };
}
