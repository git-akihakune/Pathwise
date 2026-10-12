import type { AppConfig } from "@pathwise/core/config";
import { createLogger } from "@pathwise/core/logger";
import { PgBoss } from "pg-boss";
import { HEARTBEAT_PATH, startHeartbeat } from "./heartbeat";

export async function startWorker(config: Pick<AppConfig, "databaseUrl">): Promise<void> {
  const log = createLogger("worker");
  const boss = new PgBoss(config.databaseUrl);
  boss.on("error", (err) => log.error({ err }, "pg-boss error"));
  await boss.start();
  const stopHeartbeat = startHeartbeat(HEARTBEAT_PATH);
  log.info("worker started");

  const shutdown = () => {
    stopHeartbeat();
    boss
      .stop({ graceful: true })
      .then(() => process.exit(0))
      .catch((err) => {
        log.error({ err }, "shutdown failed");
        process.exit(1);
      });
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}
