import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { type Db, schema } from "../db";
import { NotFoundError } from "../errors";

export interface Invite {
  id: string;
  email: string;
  expiresAt: Date;
  usedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function toInvite(row: typeof schema.invites.$inferSelect): Invite {
  return {
    id: row.id,
    email: row.email,
    expiresAt: row.expiresAt,
    usedAt: row.usedAt,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
  };
}

export async function createInvite(
  db: Db,
  input: { email: string; createdBy: string; ttlDays?: number; now?: Date },
): Promise<{ invite: Invite; token: string }> {
  const now = input.now ?? new Date();
  const token = randomBytes(32).toString("base64url");
  const [row] = await db
    .insert(schema.invites)
    .values({
      email: normalizeEmail(input.email),
      tokenHash: hashInviteToken(token),
      createdBy: input.createdBy,
      expiresAt: new Date(now.getTime() + (input.ttlDays ?? 7) * DAY_MS),
    })
    .returning();
  if (!row) throw new Error("failed to create invite");
  return { invite: toInvite(row), token };
}

export async function findUsableInvite(
  db: Db,
  token: string,
  email: string,
  now: Date = new Date(),
): Promise<Invite | null> {
  const [row] = await db
    .select()
    .from(schema.invites)
    .where(
      and(
        eq(schema.invites.tokenHash, hashInviteToken(token)),
        eq(schema.invites.email, normalizeEmail(email)),
        isNull(schema.invites.usedAt),
        isNull(schema.invites.revokedAt),
        gt(schema.invites.expiresAt, now),
      ),
    );
  return row ? toInvite(row) : null;
}

export async function markInviteUsed(
  db: Db,
  inviteId: string,
  userId: string,
  now: Date = new Date(),
): Promise<void> {
  await db
    .update(schema.invites)
    .set({ usedAt: now, usedBy: userId })
    .where(eq(schema.invites.id, inviteId));
}

export type InviteStatus = "usable" | "used" | "expired" | "revoked";

// Precedence when several apply: revoked > used > expired > usable.
function inviteStatus(invite: Invite, now: Date): InviteStatus {
  if (invite.revokedAt) return "revoked";
  if (invite.usedAt) return "used";
  if (invite.expiresAt <= now) return "expired";
  return "usable";
}

export async function describeInvite(
  db: Db,
  token: string,
  now: Date = new Date(),
): Promise<{ status: InviteStatus; email: string } | { status: "unknown" }> {
  const [row] = await db
    .select()
    .from(schema.invites)
    .where(eq(schema.invites.tokenHash, hashInviteToken(token)));
  if (!row) return { status: "unknown" };
  return { status: inviteStatus(toInvite(row), now), email: row.email };
}

/** Newest first. */
export async function listInvites(
  db: Db,
  now: Date = new Date(),
): Promise<(Invite & { status: InviteStatus })[]> {
  const rows = await db.select().from(schema.invites).orderBy(desc(schema.invites.createdAt));
  return rows.map((row) => {
    const invite = toInvite(row);
    return { ...invite, status: inviteStatus(invite, now) };
  });
}

/** Revokes an unused invite. Already-revoked is a no-op; unknown or used invites throw NotFoundError. */
export async function revokeInvite(
  db: Db,
  inviteId: string,
  now: Date = new Date(),
): Promise<void> {
  const revoked = await db
    .update(schema.invites)
    .set({ revokedAt: now })
    .where(
      and(
        eq(schema.invites.id, inviteId),
        isNull(schema.invites.usedAt),
        isNull(schema.invites.revokedAt),
      ),
    )
    .returning({ id: schema.invites.id });
  if (revoked.length > 0) return;
  const [existing] = await db
    .select({ revokedAt: schema.invites.revokedAt, usedAt: schema.invites.usedAt })
    .from(schema.invites)
    .where(eq(schema.invites.id, inviteId));
  if (existing?.revokedAt && !existing.usedAt) return;
  throw new NotFoundError("invite not found or already used");
}
