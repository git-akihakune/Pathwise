import { setTimeout } from "node:timers/promises";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getTestDb, resetDb } from "../../../../test/integration/db";
import { ADMIN_LOCK_KEY } from "../auth";
import { schema } from "../db";
import { ForbiddenError, NotFoundError } from "../errors";
import { ensureInstanceSettings, getInstanceSettings } from "../instance";
import { describeInvite, markInviteUsed } from "../invites";
import {
  inviteUser,
  listInvites,
  listUsers,
  promoteToAdmin,
  revokeInvite,
  setSignupMode,
} from "./service";

const db = getTestDb();
beforeEach(async () => {
  await resetDb(db);
  await ensureInstanceSettings(db);
  await db.insert(schema.user).values([
    { id: "adm", name: "Ada", email: "ada@x.io", emailVerified: false, role: "admin" },
    { id: "usr", name: "Bob", email: "bob@x.io", emailVerified: false, role: "user" },
  ]);
});

describe("admin service", () => {
  it("forbids non-admins everywhere", async () => {
    await expect(listUsers(db, "usr")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(setSignupMode(db, "usr", "open")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(inviteUser(db, "usr", "c@x.io")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listInvites(db, "usr")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      revokeInvite(db, "usr", "00000000-0000-0000-0000-000000000000"),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
  it("forbids unknown actors", async () => {
    await expect(listUsers(db, "ghost")).rejects.toBeInstanceOf(ForbiddenError);
  });
  it("promotes a user to admin and authorizes admins only", async () => {
    await expect(promoteToAdmin(db, "usr", "usr")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(promoteToAdmin(db, "ghost", "usr")).rejects.toBeInstanceOf(ForbiddenError);
    await promoteToAdmin(db, "adm", "usr");
    expect((await listUsers(db, "adm")).find((u) => u.id === "usr")?.role).toBe("admin");
    await expect(promoteToAdmin(db, "adm", "missing")).rejects.toBeInstanceOf(NotFoundError);
  });
  it("rechecks promotion authorization after waiting for the shared admin lock", async () => {
    await db
      .insert(schema.user)
      .values({ id: "adm2", name: "Other admin", email: "other@x.io", role: "admin" });
    let promotion: Promise<unknown> | undefined;
    await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(${ADMIN_LOCK_KEY})`);
      // Catch immediately so a broken implementation cannot produce an unhandled rejection.
      promotion = promoteToAdmin(db, "adm", "usr").catch((error: unknown) => error);
      let waiting = false;
      for (let i = 0; i < 100; i++) {
        const result = await tx.execute<{ waiting: boolean }>(sql`
          select exists(select 1 from pg_locks where locktype = 'advisory'
            and objid = ${ADMIN_LOCK_KEY} and not granted) as waiting`);
        if (result.rows[0]?.waiting) {
          waiting = true;
          break;
        }
        await setTimeout(10);
      }
      expect(waiting, "Promotion must wait for the admin-count lock").toBe(true);
      await tx.delete(schema.user).where(eq(schema.user.id, "adm"));
    });
    expect(await promotion).toBeInstanceOf(ForbiddenError);
    expect(await db.$count(schema.user, eq(schema.user.role, "admin"))).toBe(1);
  });
  it("lists users and changes sign-up mode", async () => {
    expect((await listUsers(db, "adm")).map((u) => u.email)).toEqual(["ada@x.io", "bob@x.io"]);
    await setSignupMode(db, "adm", "closed");
    expect((await getInstanceSettings(db)).signupMode).toBe("closed");
  });
  it("creates, lists, and revokes invites", async () => {
    const { invite, token } = await inviteUser(db, "adm", "Carol@x.io");
    expect((await listInvites(db, "adm"))[0]).toMatchObject({
      email: "carol@x.io",
      status: "usable",
    });
    await revokeInvite(db, "adm", invite.id);
    expect(await describeInvite(db, token)).toEqual({ status: "revoked", email: "carol@x.io" });
    expect((await listInvites(db, "adm"))[0]).toMatchObject({ status: "revoked" });
  });
  it("revoke: unknown id is NotFound; used invite is rejected; revoking twice keeps the first time", async () => {
    await expect(
      revokeInvite(db, "adm", "00000000-0000-0000-0000-000000000000"),
    ).rejects.toBeInstanceOf(NotFoundError);
    const a = await inviteUser(db, "adm", "a@x.io");
    await markInviteUsed(db, a.invite.id, "usr");
    await expect(revokeInvite(db, "adm", a.invite.id)).rejects.toBeInstanceOf(NotFoundError);
    expect(await describeInvite(db, a.token)).toEqual({ status: "used", email: "a@x.io" });
    const b = await inviteUser(db, "adm", "b@x.io");
    await revokeInvite(db, "adm", b.invite.id);
    await expect(revokeInvite(db, "adm", b.invite.id)).resolves.toBeUndefined();
  });
  it("lists invites newest first", async () => {
    await inviteUser(db, "adm", "first@x.io");
    await inviteUser(db, "adm", "second@x.io");
    expect((await listInvites(db, "adm")).map((i) => i.email)).toEqual([
      "second@x.io",
      "first@x.io",
    ]);
  });
});
