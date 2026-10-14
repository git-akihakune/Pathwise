import "server-only";
import { type JobAdmin, type JobQueue, pgBossJobAdmin, pgBossQueue } from "@pathwise/core/jobs";
import { createLogger } from "@pathwise/core/logger";
import { PgBoss } from "pg-boss";
import { getServer } from "./server";

const log = createLogger("web");
const globalForBoss = globalThis as typeof globalThis & { __pathwiseBoss?: Promise<PgBoss> };

/**
 * The web process's pg-boss instance, started once. It only sends: the worker owns the
 * maintenance and cron, and `init` owns the schema.
 */
export function getBoss(): Promise<PgBoss> {
  if (!globalForBoss.__pathwiseBoss) {
    const boss = new PgBoss({
      connectionString: getServer().config.databaseUrl,
      supervise: false,
      schedule: false,
      migrate: false,
    });
    boss.on("error", (err) => log.error({ err }, "pg-boss error"));
    globalForBoss.__pathwiseBoss = boss.start().then(() => boss);
    // A failed start must not be memoized forever.
    globalForBoss.__pathwiseBoss.catch(() => {
      globalForBoss.__pathwiseBoss = undefined;
    });
  }
  return globalForBoss.__pathwiseBoss;
}

export function getJobQueue(): JobQueue {
  return { send: async (...a) => pgBossQueue(await getBoss()).send(...a) };
}

export async function getJobAdmin(): Promise<JobAdmin> {
  return pgBossJobAdmin(await getBoss());
}
