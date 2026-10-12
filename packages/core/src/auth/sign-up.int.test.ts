import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getTestDb, resetDb } from "../../../../test/integration/db";
import { schema } from "../db";
import { ensureInstanceSettings } from "../instance";
import { createInvite } from "../invites";
import { countUsers, createAuth, signUp, userExists } from ".";

const db = getTestDb();
const auth = createAuth({
  db,
  config: { appUrl: "http://localhost:3000", betterAuthSecret: "x".repeat(44) },
});
const deps = { auth, db };
const pw = "correct-horse-battery";
const setMode = (m: "open" | "invite_only" | "closed") =>
  db.update(schema.instanceSettings).set({ signupMode: m });

beforeEach(async () => {
  await resetDb(db);
  await ensureInstanceSettings(db);
});

describe("signUp", () => {
  it("makes the first user admin", async () => {
    const r = await signUp(deps, { name: "Ada", email: "ada@x.io", password: pw });
    expect(r).toMatchObject({ ok: true, role: "admin" });
  });
  it("requires an invite after bootstrap (default invite_only)", async () => {
    await signUp(deps, { name: "Ada", email: "ada@x.io", password: pw });
    expect(await signUp(deps, { name: "Bob", email: "bob@x.io", password: pw })).toEqual({
      ok: false,
      reason: "invite_required",
    });
    expect(await countUsers(db)).toBe(1);
  });
  it("accepts a valid invite once, case-insensitively", async () => {
    const admin = await signUp(deps, { name: "Ada", email: "ada@x.io", password: pw });
    if (!admin.ok) throw new Error("bootstrap failed");
    const { invite, token } = await createInvite(db, {
      email: "Bob@X.io",
      createdBy: admin.userId,
    });
    expect(
      await signUp(deps, { name: "Bob", email: "bob@x.io", password: pw, inviteToken: token }),
    ).toMatchObject({ ok: true, role: "user" });
    const [row] = await db.select().from(schema.invites).where(eq(schema.invites.id, invite.id));
    expect(row?.usedAt).toBeInstanceOf(Date);
    // Remove the account so the replay hits the invite check, not the duplicate-email check.
    await db.delete(schema.user).where(eq(schema.user.email, "bob@x.io"));
    expect(
      await signUp(deps, { name: "Bob2", email: "bob@x.io", password: pw, inviteToken: token }),
    ).toEqual({ ok: false, reason: "invite_invalid" });
  });
  it("honours open and closed modes", async () => {
    await signUp(deps, { name: "Ada", email: "ada@x.io", password: pw });
    await setMode("open");
    expect(await signUp(deps, { name: "C", email: "c@x.io", password: pw })).toMatchObject({
      ok: true,
      role: "user",
    });
    await setMode("closed");
    expect(await signUp(deps, { name: "D", email: "d@x.io", password: pw })).toEqual({
      ok: false,
      reason: "closed",
    });
  });
  it("rejects duplicate emails regardless of case (Review Focus 3)", async () => {
    await signUp(deps, { name: "Ada", email: "ada@x.io", password: pw });
    await setMode("open");
    expect(await signUp(deps, { name: "Ada2", email: "ADA@x.io", password: pw })).toEqual({
      ok: false,
      reason: "email_taken",
    });
  });
  it("rejects passwords shorter than 12", async () => {
    expect(await signUp(deps, { name: "Ada", email: "ada@x.io", password: "elevenchars" })).toEqual(
      { ok: false, reason: "weak_password" },
    );
  });
  it("maps over-long passwords to weak_password instead of throwing", async () => {
    expect(
      await signUp(deps, { name: "Ada", email: "ada@x.io", password: "x".repeat(129) }),
    ).toEqual({ ok: false, reason: "weak_password" });
  });
  it("rejects invalid input", async () => {
    expect(await signUp(deps, { name: "", email: "not-an-email", password: pw })).toEqual({
      ok: false,
      reason: "invalid_input",
    });
  });
  it("blocks direct Better Auth sign-up that bypasses the policy", async () => {
    await expect(
      auth.api.signUpEmail({ body: { name: "Eve", email: "eve@x.io", password: pw } }),
    ).rejects.toThrow();
    expect(await countUsers(db)).toBe(0);
  });
  it("closes the public HTTP sign-in/up routes but not direct auth.api calls", async () => {
    await signUp(deps, { name: "Ada", email: "ada@x.io", password: pw });
    for (const path of ["sign-in/email", "sign-up/email"]) {
      const res = await auth.handler(
        new Request(`http://localhost:3000/api/auth/${path}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "A", email: "a@x.io", password: "x".repeat(12) }),
        }),
      );
      expect(res.status).toBe(404);
    }
    await expect(
      auth.api.signInEmail({ body: { email: "ada@x.io", password: pw } }),
    ).resolves.toBeTruthy();
  });
  it("reports whether an account exists, case-insensitively", async () => {
    await signUp(deps, { name: "Ada", email: "ada@x.io", password: pw });
    expect(await userExists(db, "ADA@x.io")).toBe(true);
    expect(await userExists(db, "nobody@x.io")).toBe(false);
  });
  it("makes exactly one admin under concurrent bootstrap (Review Focus 1)", async () => {
    const results = await Promise.all([
      signUp(deps, { name: "A", email: "a@x.io", password: pw }),
      signUp(deps, { name: "B", email: "b@x.io", password: pw }),
    ]);
    expect(results.filter((r) => r.ok && r.role === "admin")).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.reason === "invite_required")).toHaveLength(1);
  });
  it("does not exhaust the pool under many concurrent sign-ups (R5)", async () => {
    await signUp(deps, { name: "Ada", email: "ada@x.io", password: pw });
    await setMode("open");
    const results = await Promise.all(
      Array.from({ length: 30 }, (_, i) =>
        signUp(deps, { name: `U${i}`, email: `u${i}@x.io`, password: pw }),
      ),
    );
    expect(results.every((r) => r.ok)).toBe(true);
    expect(await countUsers(db)).toBe(31);
  });
  it("releases the queue after a failed sign-up", async () => {
    await signUp(deps, { name: "Ada", email: "ada@x.io", password: pw });
    expect(await signUp(deps, { name: "B", email: "b@x.io", password: pw })).toMatchObject({
      ok: false,
    });
    await setMode("open");
    expect(await signUp(deps, { name: "B", email: "b@x.io", password: pw })).toMatchObject({
      ok: true,
    });
  });
});
