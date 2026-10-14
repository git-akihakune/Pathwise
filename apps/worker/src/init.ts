import { ensureSecrets, loadBaseConfig, type SecretName } from "@pathwise/core/config";
import { createDb, runMigrations } from "@pathwise/core/db";
import { ensureInstanceSettings } from "@pathwise/core/instance";
import { coreJobs, ensureQueues } from "@pathwise/core/jobs";
import { createLogger } from "@pathwise/core/logger";
import { seedDemo } from "@pathwise/core/seed";
import { importTaxonomySnapshot } from "@pathwise/core/taxonomy";
import { PgBoss } from "pg-boss";

export interface InitReport {
  generatedSecrets: SecretName[];
  taxonomy: { imported: boolean; version: string };
  demo: "skipped" | "seeded" | "exists";
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

  let taxonomy: InitReport["taxonomy"];
  let demo: InitReport["demo"] = "skipped";
  const { db, pool } = createDb(config.databaseUrl);
  try {
    await runMigrations(db, opts.migrationsFolder);
    log.info("migrations applied");
    await ensureInstanceSettings(db);
    log.info("instance settings ready");
    taxonomy = await importTaxonomySnapshot(db, config.taxonomyDir);
    log.info(
      { version: taxonomy.version },
      taxonomy.imported ? "taxonomy imported" : "taxonomy up to date",
    );
    if (config.seedDemo) {
      const result = await seedDemo({ db });
      demo = result.created ? "seeded" : "exists";
      if (result.created) {
        log.info({ email: result.email }, "demo persona seeded");
        log.info(
          `sign in as the demo user: docker compose exec worker pathwise admin reset-password ${result.email}`,
        );
      } else {
        log.info({ email: result.email }, "demo already seeded");
      }
    }
  } finally {
    await pool.end();
  }

  const boss = new PgBoss(config.databaseUrl);
  boss.on("error", (err) => log.error({ err }, "pg-boss error"));
  await boss.start();
  await ensureQueues(boss, coreJobs);
  await boss.stop();
  log.info("pg-boss schema and queues ready");
  return { generatedSecrets: generated, taxonomy, demo };
}
