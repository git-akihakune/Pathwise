import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getTestDb, MIGRATIONS_FOLDER, resetDb } from "../../../../test/integration/db";
import { runMigrations } from "../db";
import { ensureInstanceSettings, getInstanceSettings } from "./service";

const db = getTestDb();
beforeEach(() => resetDb(db));

describe("instance settings", () => {
  it("migrations are re-runnable", async () => {
    await expect(runMigrations(db, MIGRATIONS_FOLDER)).resolves.toBeUndefined();
  });
  it("creates exactly one row defaulting to invite_only, idempotently", async () => {
    await ensureInstanceSettings(db);
    await ensureInstanceSettings(db);
    const rows = await db.execute(sql`select count(*)::int as n from instance_settings`);
    expect(rows.rows[0]).toEqual({ n: 1 });
    expect((await getInstanceSettings(db)).signupMode).toBe("invite_only");
  });
  it("rejects a second row", async () => {
    await ensureInstanceSettings(db);
    await expect(db.execute(sql`insert into instance_settings (id) values (2)`)).rejects.toThrow();
  });
});
