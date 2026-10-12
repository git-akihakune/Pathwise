import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { expect, inject, it } from "vitest";
import {
  getTestDb,
  MIGRATIONS_FOLDER,
  resetDb,
  TAXONOMY_FIXTURE_DIR,
} from "../../../test/integration/db";
import { runInit } from "./init";

it("is idempotent, installs pg-boss, and imports the taxonomy once", async () => {
  await resetDb(getTestDb());
  const version = JSON.parse(
    readFileSync(join(TAXONOMY_FIXTURE_DIR, "manifest.json"), "utf8"),
  ).version;
  const env = {
    DATABASE_URL: inject("databaseUrl"),
    TAXONOMY_DIR: TAXONOMY_FIXTURE_DIR,
    SECRETS_DIR: join(mkdtempSync(join(tmpdir(), "init-")), "s"),
  };
  expect(await runInit(env, { migrationsFolder: MIGRATIONS_FOLDER })).toEqual({
    generatedSecrets: ["APP_ENCRYPTION_KEY", "BETTER_AUTH_SECRET"],
    taxonomy: { imported: true, version },
  });
  expect(await runInit(env, { migrationsFolder: MIGRATIONS_FOLDER })).toEqual({
    generatedSecrets: [],
    taxonomy: { imported: false, version },
  });
  const r = await getTestDb().execute(
    sql`select 1 from information_schema.schemata where schema_name = 'pgboss'`,
  );
  expect(r.rows).toHaveLength(1);
  const q = await getTestDb().execute(
    sql`select name from pgboss.queue where name in ('maintenance.tick', 'maintenance.tick.dead')`,
  );
  expect(q.rows).toHaveLength(2);
});
