import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getTestDb, resetDb } from "../../../../test/integration/db";
import { schema } from "../db";
import { createInvite, findUsableInvite, hashInviteToken, markInviteUsed } from "./service";

const db = getTestDb();
let adminId: string;
beforeEach(async () => {
  await resetDb(db);
  adminId = "admin-1";
  await db
    .insert(schema.user)
    .values({ id: adminId, name: "A", email: "a@x.io", emailVerified: false, role: "admin" });
});

describe("invites", () => {
  it("stores only the token hash", async () => {
    const { invite, token } = await createInvite(db, { email: "b@x.io", createdBy: adminId });
    const [row] = await db.select().from(schema.invites).where(eq(schema.invites.id, invite.id));
    expect(row?.tokenHash).toBe(hashInviteToken(token));
    expect(row?.tokenHash).not.toBe(token);
  });
  it("matches email case-insensitively (Review Focus 3)", async () => {
    const { token } = await createInvite(db, { email: "Alice@Example.com", createdBy: adminId });
    expect(await findUsableInvite(db, token, "  alice@example.COM ")).not.toBeNull();
  });
  it("rejects a different email", async () => {
    const { token } = await createInvite(db, { email: "b@x.io", createdBy: adminId });
    expect(await findUsableInvite(db, token, "c@x.io")).toBeNull();
  });
  it("rejects expired invites (default ttl 7 days)", async () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const { token } = await createInvite(db, { email: "b@x.io", createdBy: adminId, now });
    expect(
      await findUsableInvite(db, token, "b@x.io", new Date("2026-01-07T23:59:00Z")),
    ).not.toBeNull();
    expect(
      await findUsableInvite(db, token, "b@x.io", new Date("2026-01-08T00:00:01Z")),
    ).toBeNull();
  });
  it("rejects used invites", async () => {
    const { invite, token } = await createInvite(db, { email: "b@x.io", createdBy: adminId });
    await markInviteUsed(db, invite.id, adminId);
    expect(await findUsableInvite(db, token, "b@x.io")).toBeNull();
  });
});
