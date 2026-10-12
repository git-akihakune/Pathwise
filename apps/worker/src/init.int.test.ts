import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { expect, inject, it } from "vitest";
import { getTestDb, MIGRATIONS_FOLDER } from "../../../test/integration/db";
import { runInit } from "./init";

it("is idempotent and installs the pg-boss schema", async () => {
  const env = {
    DATABASE_URL: inject("databaseUrl"),
    SECRETS_DIR: join(mkdtempSync(join(tmpdir(), "init-")), "s"),
  };
  expect(await runInit(env, { migrationsFolder: MIGRATIONS_FOLDER })).toEqual({
    generatedSecrets: ["APP_ENCRYPTION_KEY", "BETTER_AUTH_SECRET"],
  });
  expect(await runInit(env, { migrationsFolder: MIGRATIONS_FOLDER })).toEqual({
    generatedSecrets: [],
  });
  const r = await getTestDb().execute(
    sql`select 1 from information_schema.schemata where schema_name = 'pgboss'`,
  );
  expect(r.rows).toHaveLength(1);
});
