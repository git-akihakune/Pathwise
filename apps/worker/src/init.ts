import { ensureSecrets, loadBaseConfig, type SecretName } from "@pathwise/core/config";
import { createDb, runMigrations } from "@pathwise/core/db";
import { ensureInstanceSettings } from "@pathwise/core/instance";
import { createLogger } from "@pathwise/core/logger";
import { PgBoss } from "pg-boss";

export interface InitReport {
  generatedSecrets: SecretName[];
}

/** Idempotent setup: secrets, migrations, instance settings, pg-boss schema. */
export async function runInit(
  env: NodeJS.ProcessEnv,
  opts: { migrationsFolder: string },
): Promise<InitReport> {
  const log = createLogger("init");
  const config = loadBaseConfig(env);
  const { generated } = await ensureSecrets(config.secretsDir, env);
  log.info({ generated }, "secrets ready");

  const { db, pool } = createDb(config.databaseUrl);
  try {
    await runMigrations(db, opts.migrationsFolder);
    log.info("migrations applied");
    await ensureInstanceSettings(db);
    log.info("instance settings ready");
  } finally {
    await pool.end();
  }

  const boss = new PgBoss(config.databaseUrl);
  boss.on("error", (err) => log.error({ err }, "pg-boss error"));
  await boss.start();
  await boss.stop();
  log.info("pg-boss schema ready");
  return { generatedSecrets: generated };
}
