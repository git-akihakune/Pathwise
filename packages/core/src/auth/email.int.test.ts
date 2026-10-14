import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTestDb, resetDb } from "../../../../test/integration/db";
import { fakeMailer } from "../../../../test/integration/fixtures";
import { schema } from "../db";
import { ensureInstanceSettings } from "../instance";
import { createAuth, signUp } from ".";

const db = getTestDb();
const config = { appUrl: "http://localhost:3000", betterAuthSecret: "x".repeat(44) };
const pw = "correct-horse-battery";
beforeEach(async () => {
  await resetDb(db);
  await ensureInstanceSettings(db);
});

describe("auth email", () => {
  it("sends a verification email on sign-up without requiring it", async () => {
    const mailer = fakeMailer();
    const auth = createAuth({ db, config, mailer });
    expect(
      await signUp({ auth, db }, { name: "Ada", email: "ada@x.io", password: pw }),
    ).toMatchObject({ ok: true });
    await vi.waitFor(() => expect(mailer.sent).toHaveLength(1));
    expect(mailer.sent[0]).toMatchObject({
      to: "ada@x.io",
      subject: "Verify your email for Pathwise",
    });
    expect(mailer.sent[0]?.html).toContain("/api/auth/verify-email?token=");
    await expect(
      auth.api.signInEmail({ body: { email: "ada@x.io", password: pw } }),
    ).resolves.toBeTruthy();
  });
  it("emails a working reset link", async () => {
    const mailer = fakeMailer();
    const auth = createAuth({ db, config, mailer });
    await signUp({ auth, db }, { name: "Ada", email: "ada@x.io", password: pw });
    await vi.waitFor(() => expect(mailer.sent).toHaveLength(1));
    await auth.api.requestPasswordReset({
      body: { email: "ada@x.io", redirectTo: "/reset-password" },
    });
    await vi.waitFor(() => expect(mailer.sent).toHaveLength(2));
    expect(mailer.sent[1]?.subject).toBe("Reset your Pathwise password");
    const token = /reset-password\/([^?"&]+)/.exec(mailer.sent[1]?.text ?? "")?.[1];
    expect(token).toBeTruthy();
    await auth.api.resetPassword({
      body: { token: token as string, newPassword: "a-brand-new-password" },
    });
    await expect(
      auth.api.signInEmail({ body: { email: "ada@x.io", password: "a-brand-new-password" } }),
    ).resolves.toBeTruthy();
  });
  it("offers no email reset without SMTP", async () => {
    const auth = createAuth({ db, config });
    await signUp({ auth, db }, { name: "Ada", email: "ada@x.io", password: pw });
    await expect(auth.api.requestPasswordReset({ body: { email: "ada@x.io" } })).rejects.toThrow();
  });
  it("revokes existing sessions when the password is reset", async () => {
    const mailer = fakeMailer();
    const auth = createAuth({ db, config, mailer });
    await signUp({ auth, db }, { name: "Ada", email: "ada@x.io", password: pw });
    const signedIn = await auth.api.signInEmail({
      body: { email: "ada@x.io", password: pw },
      returnHeaders: true,
    });
    const cookie = signedIn.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
    const headers = new Headers({ cookie });
    expect(await auth.api.getSession({ headers })).toBeTruthy();
    await auth.api.requestPasswordReset({
      body: { email: "ada@x.io", redirectTo: "/reset-password" },
    });
    await vi.waitFor(() => expect(mailer.sent).toHaveLength(2));
    const token = /reset-password\/([^?"&]+)/.exec(mailer.sent[1]?.text ?? "")?.[1] as string;
    await auth.api.resetPassword({ body: { token, newPassword: "a-brand-new-password" } });
    expect(await auth.api.getSession({ headers })).toBeNull();
  });
  it("verification link verifies the email but creates no session", async () => {
    const mailer = fakeMailer();
    const auth = createAuth({ db, config, mailer });
    await signUp({ auth, db }, { name: "Ada", email: "ada@x.io", password: pw });
    await vi.waitFor(() => expect(mailer.sent).toHaveLength(1));
    const token = /verify-email\?token=([^&"\s]+)/.exec(mailer.sent[0]?.html ?? "")?.[1] as string;
    const sessionsBefore = await db.$count(schema.session);
    const res = await auth.api.verifyEmail({ query: { token }, returnHeaders: true });
    expect(res.headers.getSetCookie().join(";")).not.toContain("session_token");
    expect(await db.$count(schema.session)).toBe(sessionsBefore);
    const user = await db.query.user.findFirst();
    expect(user?.emailVerified).toBe(true);
  });
});
