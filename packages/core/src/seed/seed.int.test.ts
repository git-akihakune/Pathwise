import { verifyPassword } from "better-auth/crypto";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getTestDb, resetDb } from "../../../../test/integration/db";
import { countAdmins, createAuth, createCredentialUser, signUp } from "../auth";
import { schema } from "../db";
import { ensureInstanceSettings } from "../instance";
import { listMemory } from "../services/memory";
import { listPaths } from "../services/paths";
import { actionsForWeek, getActivePlan } from "../services/plan";
import { createExperience, getProfile } from "../services/profile";
import { listProposals } from "../services/proposals";
import { listConversation } from "../services/sessions";
import { listStories } from "../services/stories";
import { getOnboardingState } from "../workflows";
import { DEMO_EMAIL, seedDemo } from ".";

const db = getTestDb();
const NOW = new Date("2026-10-14T09:00:00Z"); // Wednesday; Monday in Europe/London = 2026-10-12
const auth = createAuth({
  db,
  config: { appUrl: "http://localhost:3000", betterAuthSecret: "x".repeat(44) },
});
const usersNamed = (email: string) =>
  db.select().from(schema.user).where(eq(schema.user.email, email));

// A missing transaction or destructive collision recovery changes this real DB snapshot.
async function snapshot() {
  const { rows } = await db.execute<{ tablename: string }>(
    sql`select tablename from pg_tables where schemaname = 'public' order by tablename`,
  );
  const data: Record<string, unknown> = {};
  for (const { tablename } of rows) {
    const table = `"public"."${tablename.replaceAll('"', '""')}"`;
    data[tablename] = (
      await db.execute(
        sql.raw(`select to_jsonb(t) as row from ${table} t order by to_jsonb(t)::text`),
      )
    ).rows;
  }
  return data;
}

beforeEach(async () => {
  await resetDb(db);
  await ensureInstanceSettings(db);
});

describe("seedDemo", () => {
  it("creates the full demo persona as a regular user", async () => {
    const r = await seedDemo({ db }, { now: NOW });
    if (!r.created) throw new Error("expected a fresh seed");
    expect(r.email).toBe(DEMO_EMAIL);
    expect(await countAdmins(db)).toBe(0);
    expect(r.password).toMatch(/^[A-Za-z0-9_-]{20}$/);
    const [u] = await usersNamed(DEMO_EMAIL);
    expect(u).toMatchObject({ role: "user", emailVerified: true, name: "Maya Okafor" });
    const [account] = await db
      .select()
      .from(schema.account)
      .where(eq(schema.account.userId, r.userId));
    expect(account).toMatchObject({ providerId: "credential", accountId: r.userId });
    expect(account?.password).not.toBe(r.password);
    expect(await verifyPassword({ hash: account?.password ?? "", password: r.password })).toBe(
      true,
    );

    const profile = await getProfile(db, r.userId);
    expect(profile.experiences.map((e) => e.title).sort()).toEqual([
      "Assistant Manager",
      "Front of House Supervisor",
      "General Manager",
    ]);
    expect(profile.education).toHaveLength(2);
    expect(profile.skills).toHaveLength(7);
    expect(await listStories(db, r.userId)).toHaveLength(2);
    expect((await listPaths(db, r.userId)).map((p) => [p.title, p.status])).toEqual(
      expect.arrayContaining([
        ["UX Researcher via a customer-insights bridge role", "chosen"],
        ["Customer Experience Manager at a tech company", "explored"],
      ]),
    );
    const plan = await getActivePlan(db, r.userId);
    expect(plan?.northStar).toBe("Work as a UX researcher at a product company within 18 months.");
    expect(plan?.milestones).toHaveLength(3);
    expect(await actionsForWeek(db, r.userId, "2026-10-12")).toHaveLength(3);
    expect((await actionsForWeek(db, r.userId, "2026-10-05")).map((a) => a.status)).toEqual([
      "done",
    ]);
    const convo = await listConversation(db, r.userId);
    expect(convo).toHaveLength(2);
    expect(convo.flatMap((c) => c.messages)).toHaveLength(8);
    expect(convo[0]?.session.startedAt.getTime()).toBeLessThan(NOW.getTime() - 5 * 86_400_000); // backdated
    expect(await getOnboardingState(db, r.userId)).toBe("completed"); // Today shows no setup card
    expect(await listMemory(db, r.userId, { status: ["active"] })).toHaveLength(7);
    expect(await listMemory(db, r.userId, { status: ["pending"] })).toHaveLength(1);
    expect(await listProposals(db, r.userId, { status: ["pending"] })).toHaveLength(1);
  });
  it("is idempotent", async () => {
    const first = await seedDemo({ db }, { now: NOW });
    expect(await seedDemo({ db }, { now: NOW })).toEqual({
      created: false,
      userId: first.userId,
      email: DEMO_EMAIL,
    });
    expect((await getProfile(db, first.userId)).experiences).toHaveLength(3);
    expect(await usersNamed(DEMO_EMAIL)).toHaveLength(1);
  });
  it("refuses a no-plan email collision and preserves every existing row", async () => {
    const { userId } = await createCredentialUser(db, {
      name: "Existing person",
      email: DEMO_EMAIL,
      role: "user",
    });
    await createExperience(db, userId, { title: "My work", highlights: ["Keep this"] });
    const before = await snapshot();
    await expect(seedDemo({ db }, { now: NOW })).rejects.toThrow(
      "already exists without an active plan",
    );
    expect(await snapshot()).toEqual(before);
  });
  it("rolls back the user and all persona rows when the final action status update fails", async () => {
    const before = await snapshot();
    await db.execute(
      sql`create function reject_seed_action() returns trigger language plpgsql as $$ begin raise exception 'seed action failure'; end; $$`,
    );
    await db.execute(
      sql`create trigger reject_seed_action before update on actions for each row execute function reject_seed_action()`,
    );
    try {
      await expect(seedDemo({ db }, { now: NOW })).rejects.toMatchObject({
        cause: { message: "seed action failure" },
      });
      expect(await snapshot()).toEqual(before);
    } finally {
      await db.execute(sql`drop trigger reject_seed_action on actions`);
      await db.execute(sql`drop function reject_seed_action()`);
    }
    expect(await seedDemo({ db }, { now: NOW })).toMatchObject({ created: true });
  });
  it("serializes concurrent seeds for the same normalized email", async () => {
    const results = await Promise.all([
      seedDemo({ db }, { email: " DEMO@PATHWISE.LOCAL ", now: NOW }),
      seedDemo({ db }, { now: NOW }),
      seedDemo({ db }, { now: NOW }),
    ]);
    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(new Set(results.map((r) => r.userId)).size).toBe(1);
    expect(await usersNamed(DEMO_EMAIL)).toHaveLength(1);
    expect(
      (await getProfile(db, results[0]?.userId ?? "missing-seed-user")).experiences,
    ).toHaveLength(3);
  });
  it("accepts a custom email", async () => {
    expect(await seedDemo({ db }, { email: " Show@Example.com ", now: NOW })).toMatchObject({
      created: true,
      email: "show@example.com",
    });
  });
  it("leaves bootstrap admin to the first real sign-up (Review Focus 1)", async () => {
    await seedDemo({ db }, { now: NOW });
    expect(
      await signUp(
        { auth, db },
        { name: "Ada", email: "ada@x.io", password: "correct-horse-battery" },
      ),
    ).toMatchObject({ ok: true, role: "admin" });
    expect(
      await signUp(
        { auth, db },
        { name: "Bob", email: "bob@x.io", password: "correct-horse-battery" },
      ),
    ).toEqual({ ok: false, reason: "invite_required" });
  });
});
