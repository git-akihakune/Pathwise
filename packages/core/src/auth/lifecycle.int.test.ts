import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { PgBoss } from "pg-boss";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { getTestDb, resetDb } from "../../../../test/integration/db";
import { schema } from "../db";
import { ensureInstanceSettings } from "../instance";
import { countAdmins, createAuth, signUp } from ".";

const db = getTestDb();
const origin = "http://localhost:3000";
const auth = createAuth({
  db,
  config: { appUrl: origin, betterAuthSecret: "x".repeat(44) },
});
const deps = { db, auth };
const password = "correct-horse-battery";
const boss = new PgBoss({
  connectionString: inject("databaseUrl"),
  schema: "pgboss_auth_lifecycle",
  supervise: false,
  schedule: false,
});
const queue = "pending";
let adminId: string;
let cookie: string;
let filesDir: string;

async function signIn(email: string) {
  const signedIn = await auth.api.signInEmail({
    body: { email, password },
    returnHeaders: true,
  });
  return signedIn.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
}

function post(path: string, body: unknown) {
  return auth.handler(
    new Request(`${origin}/api/auth/admin/${path}`, {
      method: "POST",
      headers: { cookie, origin, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

beforeAll(async () => {
  await boss.start();
  await boss.createQueue(queue);
});
afterAll(() => boss.stop({ graceful: false }));
beforeEach(async () => {
  await resetDb(db);
  await ensureInstanceSettings(db);
  await boss.deleteAllJobs(queue);
  filesDir = mkdtempSync(join(tmpdir(), "pw-auth-lifecycle-"));
  const admin = await signUp(deps, { name: "Ada", email: "ada@x.io", password });
  assert(admin.ok);
  adminId = admin.userId;
  cookie = await signIn("ada@x.io");
  const session = await auth.handler(
    new Request(`${origin}/api/auth/get-session`, { headers: { cookie, origin } }),
  );
  expect(session.status).toBe(200);
  expect(await session.json()).toMatchObject({ user: { id: adminId, role: "admin" } });
  await db.update(schema.instanceSettings).set({ signupMode: "closed" });
});
afterEach(() => rmSync(filesDir, { recursive: true, force: true }));

describe("public auth lifecycle boundary", () => {
  it.each(["set-role", "update-user"])(
    "blocks sole-admin demotion through %s and preserves closed registration",
    async (path) => {
      const body =
        path === "set-role"
          ? { userId: adminId, role: "user" }
          : { userId: adminId, data: { role: "user" } };
      const response = await post(path, body);
      expect.soft(response.status).toBe(404);
      const user = await db.query.user.findFirst({ where: eq(schema.user.id, adminId) });
      expect.soft(user?.role).toBe("admin");
      expect.soft(await countAdmins(db)).toBe(1);
      expect
        .soft(await signUp(deps, { name: "Outsider", email: "outsider@x.io", password }))
        .toEqual({
          ok: false,
          reason: "closed",
        });
      expect.soft(await db.$count(schema.user, eq(schema.user.email, "outsider@x.io"))).toBe(0);
    },
  );

  it("blocks public member removal and preserves rows, uploaded files and pending work", async () => {
    await db.update(schema.instanceSettings).set({ signupMode: "open" });
    const member = await signUp(deps, { name: "Bob", email: "bob@x.io", password });
    assert(member.ok);
    await signIn("bob@x.io");
    await db.update(schema.instanceSettings).set({ signupMode: "closed" });
    mkdirSync(join(filesDir, member.userId));
    const file = join(filesDir, member.userId, "cv");
    writeFileSync(file, "KEEP MEMBER CV");
    await db.insert(schema.documents).values({
      userId: member.userId,
      kind: "cv",
      filename: "cv.txt",
      mime: "text/plain",
      sizeBytes: 14,
      storagePath: `${member.userId}/cv`,
      status: "parsed",
    });
    const rowsBefore = {
      user: await db.select().from(schema.user).where(eq(schema.user.id, member.userId)),
      account: await db
        .select({
          id: schema.account.id,
          userId: schema.account.userId,
          providerId: schema.account.providerId,
        })
        .from(schema.account)
        .where(eq(schema.account.userId, member.userId)),
      session: await db
        .select({
          id: schema.session.id,
          userId: schema.session.userId,
          expiresAt: schema.session.expiresAt,
        })
        .from(schema.session)
        .where(eq(schema.session.userId, member.userId)),
      documents: await db
        .select()
        .from(schema.documents)
        .where(eq(schema.documents.userId, member.userId)),
    };
    for (const rows of Object.values(rowsBefore)) expect(rows.length).toBeGreaterThan(0);
    const jobId = await boss.send(queue, { userId: member.userId });
    assert(jobId);

    const response = await post("remove-user", { userId: member.userId });
    expect.soft(response.status).toBe(404);
    expect
      .soft(await db.select().from(schema.user).where(eq(schema.user.id, member.userId)))
      .toEqual(rowsBefore.user);
    expect
      .soft(
        await db
          .select({
            id: schema.account.id,
            userId: schema.account.userId,
            providerId: schema.account.providerId,
          })
          .from(schema.account)
          .where(eq(schema.account.userId, member.userId)),
      )
      .toEqual(rowsBefore.account);
    expect
      .soft(
        await db
          .select({
            id: schema.session.id,
            userId: schema.session.userId,
            expiresAt: schema.session.expiresAt,
          })
          .from(schema.session)
          .where(eq(schema.session.userId, member.userId)),
      )
      .toEqual(rowsBefore.session);
    expect
      .soft(
        await db.select().from(schema.documents).where(eq(schema.documents.userId, member.userId)),
      )
      .toEqual(rowsBefore.documents);
    expect.soft(await countAdmins(db)).toBe(1);
    expect.soft(readFileSync(file, "utf8")).toBe("KEEP MEMBER CV");
    expect
      .soft(await boss.findJobs(queue, { queued: true }))
      .toMatchObject([{ id: jobId, data: { userId: member.userId }, state: "created" }]);
  });

  it("keeps public admin creation blocked without creating a user or credential", async () => {
    const accountsBefore = await db.$count(schema.account);
    const response = await post("create-user", {
      name: "Outsider",
      email: "outsider@x.io",
      password,
      role: "admin",
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ message: "Sign-up must go through the app" });
    expect(await db.$count(schema.user, eq(schema.user.email, "outsider@x.io"))).toBe(0);
    expect(await db.$count(schema.account)).toBe(accountsBefore);
    expect(await countAdmins(db)).toBe(1);
  });
});
