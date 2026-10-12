import { eq } from "drizzle-orm";
import { beforeEach, expect, it } from "vitest";
import { getTestDb, resetDb } from "../../../../test/integration/db";
import { schema } from "../db";
import { NotFoundError } from "../errors";
import { ensureInstanceSettings } from "../instance";
import { createAuth, resetPassword, signUp } from ".";

const db = getTestDb();
const auth = createAuth({
  db,
  config: { appUrl: "http://localhost:3000", betterAuthSecret: "x".repeat(44) },
});
beforeEach(async () => {
  await resetDb(db);
  await ensureInstanceSettings(db);
});

it("replaces the password so only the new one signs in", async () => {
  await signUp({ auth, db }, { name: "Ada", email: "ada@x.io", password: "original-password" });
  const signedIn = await auth.api.signInEmail({
    body: { email: "ada@x.io", password: "original-password" },
  });
  expect(
    await db.$count(schema.session, eq(schema.session.userId, signedIn.user.id)),
  ).toBeGreaterThan(0);
  const fresh = await resetPassword(db, "ADA@x.io");
  expect(await db.$count(schema.session)).toBe(0);
  expect(fresh).toHaveLength(20);
  await expect(
    auth.api.signInEmail({ body: { email: "ada@x.io", password: fresh } }),
  ).resolves.toBeTruthy();
  await expect(
    auth.api.signInEmail({ body: { email: "ada@x.io", password: "original-password" } }),
  ).rejects.toThrow();
});
it("throws NotFoundError for unknown emails", async () => {
  await expect(resetPassword(db, "nobody@x.io")).rejects.toBeInstanceOf(NotFoundError);
});
