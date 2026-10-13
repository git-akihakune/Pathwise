import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { PgBoss } from "pg-boss";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { getTestDb, resetDb } from "../../../../../test/integration/db";
import { seedUser } from "../../../../../test/integration/fixtures";
import { countAdmins } from "../../auth";
import { schema } from "../../db";
import { NotFoundError, ValidationError } from "../../errors";
import { ensureInstanceSettings } from "../../instance";
import { type JobAdmin, pgBossJobAdmin } from "../../jobs";
import { seedDemo } from "../../seed";
import { deleteAccount } from ".";

const db = getTestDb();
const NOW = new Date("2026-10-14T09:00:00Z");
const boss = new PgBoss({
  connectionString: inject("databaseUrl"),
  schema: "pgboss_delete",
  supervise: false,
  schedule: false,
});
let filesDir: string;
let jobs: JobAdmin;
const deps = () => ({ db, config: { filesDir }, jobs });

async function tableCounts(): Promise<Record<string, number>> {
  const { rows } = await db.execute<{ tablename: string }>(
    sql`select tablename from pg_tables where schemaname = 'public'`,
  );
  const counts: Record<string, number> = {};
  for (const { tablename } of rows) {
    const result = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from ${sql.identifier("public")}.${sql.identifier(tablename)}`,
    );
    const row = result.rows[0];
    assert(row);
    counts[tablename] = row.n;
  }
  return counts;
}
function file(owner: string, contents: string) {
  mkdirSync(join(filesDir, owner), { recursive: true });
  writeFileSync(join(filesDir, owner, "doc-1"), contents);
}
async function queue() {
  const name = `t${randomUUID().slice(0, 8)}`;
  await boss.createQueue(`${name}.dead`);
  await boss.createQueue(name, { retryLimit: 0, deadLetter: `${name}.dead` });
  return name;
}
async function deadLetter(name: string, userId: string) {
  await boss.send(name, { userId });
  const [job] = await boss.fetch(name);
  assert(job);
  await boss.fail(name, job.id, { message: "failed" });
}

beforeAll(async () => {
  await boss.start();
  jobs = pgBossJobAdmin(boss);
});
afterAll(() => boss.stop({ graceful: false }));
beforeEach(async () => {
  await resetDb(db);
  await ensureInstanceSettings(db);
  await seedUser(db, "adm", "admin");
  filesDir = mkdtempSync(join(tmpdir(), "pw-delete-"));
  for (const q of await boss.getQueues()) await boss.deleteAllJobs(q.name);
});
afterEach(() => rmSync(filesDir, { recursive: true, force: true }));

describe("deleteAccount", () => {
  it("removes domain rows, credentials, files and queued/dead-letter jobs while preserving another user", async () => {
    const other = (await seedDemo({ db }, { email: "other@example.com", now: NOW })).userId;
    file(other, "OTHER FILE");
    await db.insert(schema.documents).values({
      userId: other,
      kind: "cv",
      filename: "cv.txt",
      mime: "text/plain",
      sizeBytes: 10,
      storagePath: `${other}/doc-1`,
      status: "parsed",
    });
    await db.insert(schema.providerConfigs).values({
      userId: other,
      kind: "openai",
      label: "Other provider",
      models: { main: "m", fast: "f" },
    });
    const q = await queue();
    await deadLetter(q, other);
    const before = await tableCounts();
    const { userId } = await seedDemo({ db }, { now: NOW });
    await db.insert(schema.providerConfigs).values({
      userId,
      kind: "openai",
      label: "Mine",
      encryptedKey: "v1:x",
      models: { main: "m", fast: "f" },
    });
    file(userId, "cv");
    await db.insert(schema.documents).values({
      userId,
      kind: "cv",
      filename: "cv.txt",
      mime: "text/plain",
      sizeBytes: 2,
      storagePath: `${userId}/doc-1`,
      status: "parsed",
    });
    await db.insert(schema.session).values({
      id: "s1",
      token: "token",
      userId,
      expiresAt: new Date("2030-01-01"),
      updatedAt: NOW,
    });
    await db.insert(schema.llmUsage).values({
      userId,
      model: "m",
      role: "main",
      purpose: "coach",
      inputTokens: 10,
      outputTokens: 5,
    });
    await db.insert(schema.userSnapshot).values({ userId, content: "Snapshot", profileVersion: 1 });
    await db.insert(schema.checkins).values({ userId, weekOf: "2026-10-12", dueAt: NOW });
    // Require a real fixture row in every user-owned table so residue checks cannot pass vacuously.
    const owned = await db.execute<{ table_name: string }>(sql`
      select table_name from information_schema.columns
      where table_schema = 'public' and column_name = 'user_id'`);
    for (const { table_name } of owned.rows) {
      const result = await db.execute<{ n: number }>(sql`
        select count(*)::int as n from ${sql.identifier(table_name)} where user_id = ${userId}`);
      expect(result.rows[0]?.n, `fixture for ${table_name}`).toBeGreaterThan(0);
    }
    await deadLetter(q, userId);
    await boss.send(q, { userId });
    await boss.send(q, { userId: other });

    expect(await deleteAccount(deps(), userId, { confirmEmail: " Demo@Pathwise.local " })).toEqual({
      ok: true,
      cancelledJobs: 2,
    });
    expect(await tableCounts()).toEqual(before);
    expect(existsSync(join(filesDir, userId))).toBe(false);
    expect(readFileSync(join(filesDir, other, "doc-1"), "utf8")).toBe("OTHER FILE");
    expect((await boss.findJobs(q, { queued: true })).map((job) => job.data)).toEqual([
      { userId: other },
    ]);
    expect((await jobs.listDeadLetters()).map((job) => job.userId)).toEqual([other]);
  });
  it("refuses a mismatched email without removing rows, files or jobs", async () => {
    await seedUser(db, "usr");
    file("usr", "KEEP");
    const q = await queue();
    await boss.send(q, { userId: "usr" });
    expect(await deleteAccount(deps(), "usr", { confirmEmail: "someone@else.io" })).toEqual({
      ok: false,
      reason: "email_mismatch",
    });
    expect(await db.$count(schema.user)).toBe(2);
    expect(existsSync(join(filesDir, "usr"))).toBe(true);
    expect(await boss.findJobs(q, { queued: true })).toHaveLength(1);
  });
  it("refuses to delete the only admin", async () => {
    expect(await deleteAccount(deps(), "adm", { confirmEmail: "adm@x.io" })).toEqual({
      ok: false,
      reason: "last_admin",
    });
    expect(await countAdmins(db)).toBe(1);
  });
  it("never leaves zero admins under concurrent deletion", async () => {
    await seedUser(db, "adm2", "admin");
    const results = await Promise.all([
      deleteAccount(deps(), "adm", { confirmEmail: "adm@x.io" }),
      deleteAccount(deps(), "adm2", { confirmEmail: "adm2@x.io" }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.reason === "last_admin")).toHaveLength(1);
    expect(await countAdmins(db)).toBe(1);
  });
  it("rejects missing accounts", async () => {
    await expect(
      deleteAccount(deps(), "missing", { confirmEmail: "missing@x.io" }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
  it("rejects unsafe filesystem IDs before deleting any rows", async () => {
    await seedUser(db, "../outside");
    await expect(
      deleteAccount(deps(), "../outside", { confirmEmail: "../outside@x.io" }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(await db.$count(schema.user, eq(schema.user.id, "../outside"))).toBe(1);
  });
  it("removes files even if job cleanup fails after committing, and reports the failure", async () => {
    await seedUser(db, "usr");
    file("usr", "REMOVE");
    const failure = new Error("queue unavailable");
    await expect(
      deleteAccount(
        {
          ...deps(),
          jobs: {
            cancelUserJobs: async () => {
              throw failure;
            },
          },
        },
        "usr",
        { confirmEmail: "usr@x.io" },
      ),
    ).rejects.toBe(failure);
    expect(await db.$count(schema.user, eq(schema.user.id, "usr"))).toBe(0);
    expect(existsSync(join(filesDir, "usr"))).toBe(false);
  });
});
