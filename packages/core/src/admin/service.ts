import { asc, eq } from "drizzle-orm";
import { type Db, schema } from "../db";
import { ForbiddenError } from "../errors";
import type { SignupMode } from "../instance";
import {
  createInvite,
  type Invite,
  type InviteStatus,
  listInvites as listAllInvites,
  revokeInvite as revokeAnyInvite,
} from "../invites";

export interface AdminUserRow {
  id: string;
  name: string;
  email: string;
  role: "admin" | "user";
  createdAt: Date;
}

export async function assertAdmin(db: Db, actorId: string): Promise<void> {
  const [row] = await db
    .select({ role: schema.user.role })
    .from(schema.user)
    .where(eq(schema.user.id, actorId));
  if (row?.role !== "admin") throw new ForbiddenError("admin access required");
}

export async function listUsers(db: Db, actorId: string): Promise<AdminUserRow[]> {
  await assertAdmin(db, actorId);
  const rows = await db.select().from(schema.user).orderBy(asc(schema.user.createdAt));
  return rows.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role === "admin" ? "admin" : "user",
    createdAt: u.createdAt,
  }));
}

export async function setSignupMode(db: Db, actorId: string, mode: SignupMode): Promise<void> {
  await assertAdmin(db, actorId);
  await db
    .update(schema.instanceSettings)
    .set({ signupMode: mode, updatedAt: new Date() })
    .where(eq(schema.instanceSettings.id, 1));
}

export async function inviteUser(
  db: Db,
  actorId: string,
  email: string,
): Promise<{ invite: Invite; token: string }> {
  await assertAdmin(db, actorId);
  return createInvite(db, { email, createdBy: actorId });
}

export async function listInvites(
  db: Db,
  actorId: string,
  now?: Date,
): Promise<(Invite & { status: InviteStatus })[]> {
  await assertAdmin(db, actorId);
  return listAllInvites(db, now);
}

export async function revokeInvite(db: Db, actorId: string, inviteId: string): Promise<void> {
  await assertAdmin(db, actorId);
  await revokeAnyInvite(db, inviteId);
}
