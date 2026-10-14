import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { countAdmins } from "@pathwise/core/auth";
import { sql } from "drizzle-orm";
import { expect, inject, it, vi } from "vitest";
import {
  getTestDb,
  MIGRATIONS_FOLDER,
  resetDb,
  TAXONOMY_FIXTURE_DIR,
} from "../../../test/integration/db";
import { runInit } from "./init";

const { logLines } = vi.hoisted(() => ({ logLines: [] as string[] }));
// Capture the init adapter's logger boundary without writing to the test runner's stdout.
vi.mock("@pathwise/core/logger", () => ({
  createLogger: () => ({
    info: (fields: string | object, msg?: string) => {
      logLines.push(
        JSON.stringify(typeof fields === "string" ? { msg: fields } : { ...fields, msg }),
      );
    },
    error: vi.fn(),
  }),
}));

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
  expect(await runInit(env, { migrationsFolder: MIGRATIONS_FOLDER })).toMatchObject({
    generatedSecrets: ["APP_ENCRYPTION_KEY", "BETTER_AUTH_SECRET"],
    taxonomy: { imported: true, version },
    demo: "skipped",
  });
  expect(await runInit(env, { migrationsFolder: MIGRATIONS_FOLDER })).toMatchObject({
    generatedSecrets: [],
    taxonomy: { imported: false, version },
    demo: "skipped",
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

it("seeds the demo persona once without taking bootstrap admin or logging a password", async () => {
  await resetDb(getTestDb());
  logLines.length = 0;
  const env = {
    DATABASE_URL: inject("databaseUrl"),
    SEED_DEMO: "true",
    TAXONOMY_DIR: TAXONOMY_FIXTURE_DIR,
    SECRETS_DIR: join(mkdtempSync(join(tmpdir(), "init-")), "s"),
  };
  expect(await runInit(env, { migrationsFolder: MIGRATIONS_FOLDER })).toMatchObject({
    demo: "seeded",
  });
  expect(await runInit(env, { migrationsFolder: MIGRATIONS_FOLDER })).toMatchObject({
    demo: "exists",
  });
  expect(
    await runInit({ ...env, SEED_DEMO: "false" }, { migrationsFolder: MIGRATIONS_FOLDER }),
  ).toMatchObject({ demo: "skipped" });
  expect(await countAdmins(getTestDb())).toBe(0);
  const demoLogs = logLines.map((s) => JSON.parse(s)).filter((r) => r.msg.includes("demo"));
  expect(demoLogs.map((r) => r.msg)).toEqual([
    "demo persona seeded",
    "sign in as the demo user: docker compose exec worker pathwise admin reset-password demo@pathwise.local",
    "demo already seeded",
  ]);
  for (const entry of demoLogs) {
    expect(entry).toEqual({
      ...(entry.msg.startsWith("demo") ? { email: "demo@pathwise.local" } : {}),
      msg: entry.msg,
    });
  }
});
