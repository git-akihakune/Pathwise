import { and, desc, eq, inArray } from "drizzle-orm";
import { type DbOrTx, schema } from "../../db";
import { NotFoundError, ValidationError } from "../../errors";

export type CheckinStatus = "scheduled" | "sent" | "nudged" | "completed" | "missed";

export interface Checkin {
  id: string;
  weekOf: string;
  dueAt: Date;
  workflowRunId: string | null;
  energy: number | null;
  summary: string | null;
  status: CheckinStatus;
  sentAt: Date | null;
  nudgedAt: Date | null;
  completedAt: Date | null;
}

function toCheckin(row: typeof schema.checkins.$inferSelect): Checkin {
  return {
    id: row.id,
    weekOf: row.weekOf,
    dueAt: row.dueAt,
    workflowRunId: row.workflowRunId,
    energy: row.energy,
    summary: row.summary,
    status: row.status as CheckinStatus,
    sentAt: row.sentAt,
    nudgedAt: row.nudgedAt,
    completedAt: row.completedAt,
  };
}

const owned = (userId: string, id: string) =>
  and(eq(schema.checkins.id, id), eq(schema.checkins.userId, userId));

/** Returns null when the user already has a check-in for that week. */
export async function createScheduledCheckin(
  db: DbOrTx,
  userId: string,
  input: { weekOf: string; dueAt: Date },
): Promise<Checkin | null> {
  const [row] = await db
    .insert(schema.checkins)
    .values({ userId, weekOf: input.weekOf, dueAt: input.dueAt })
    .onConflictDoNothing()
    .returning();
  return row ? toCheckin(row) : null;
}

export async function getCheckin(db: DbOrTx, userId: string, id: string): Promise<Checkin> {
  const [row] = await db.select().from(schema.checkins).where(owned(userId, id));
  if (!row) throw new NotFoundError("Not found.");
  return toCheckin(row);
}

export async function getCheckinForWeek(
  db: DbOrTx,
  userId: string,
  weekOf: string,
): Promise<Checkin | null> {
  const [row] = await db
    .select()
    .from(schema.checkins)
    .where(and(eq(schema.checkins.userId, userId), eq(schema.checkins.weekOf, weekOf)));
  return row ? toCheckin(row) : null;
}

export async function latestCheckin(db: DbOrTx, userId: string): Promise<Checkin | null> {
  const [row] = await db
    .select()
    .from(schema.checkins)
    .where(eq(schema.checkins.userId, userId))
    .orderBy(desc(schema.checkins.dueAt))
    .limit(1);
  return row ? toCheckin(row) : null;
}

export async function setCheckinRun(
  db: DbOrTx,
  userId: string,
  id: string,
  runId: string,
): Promise<void> {
  const rows = await db
    .update(schema.checkins)
    .set({ workflowRunId: runId, updatedAt: new Date() })
    .where(owned(userId, id))
    .returning({ id: schema.checkins.id });
  if (rows.length === 0) throw new NotFoundError("Not found.");
}

/** Stores the 1–5 energy rating (the check-in energy step's apply). */
export async function setCheckinEnergy(
  db: DbOrTx,
  userId: string,
  id: string,
  energy: number,
): Promise<void> {
  if (!(Number.isInteger(energy) && energy >= 1 && energy <= 5)) {
    throw new ValidationError("Energy must be a whole number from 1 to 5.");
  }
  const rows = await db
    .update(schema.checkins)
    .set({ energy, updatedAt: new Date() })
    .where(owned(userId, id))
    .returning({ id: schema.checkins.id });
  if (rows.length === 0) throw new NotFoundError("Not found.");
}

async function transition(
  db: DbOrTx,
  userId: string,
  id: string,
  from: CheckinStatus[],
  to: CheckinStatus,
  set: Partial<typeof schema.checkins.$inferInsert>,
): Promise<boolean> {
  const rows = await db
    .update(schema.checkins)
    .set({ ...set, status: to, updatedAt: new Date() })
    .where(and(owned(userId, id), inArray(schema.checkins.status, from)))
    .returning({ id: schema.checkins.id });
  return rows.length > 0;
}

export const markSent = (db: DbOrTx, userId: string, id: string, now: Date) =>
  transition(db, userId, id, ["scheduled"], "sent", { sentAt: now });

export const markNudged = (db: DbOrTx, userId: string, id: string, now: Date) =>
  transition(db, userId, id, ["sent"], "nudged", { nudgedAt: now });

export const markCompleted = (
  db: DbOrTx,
  userId: string,
  id: string,
  input: { summary?: string | null },
) =>
  transition(db, userId, id, ["scheduled", "sent", "nudged"], "completed", {
    completedAt: new Date(),
    ...(input.summary !== undefined && { summary: input.summary }),
  });

export const markMissed = (db: DbOrTx, userId: string, id: string) =>
  transition(db, userId, id, ["scheduled", "sent", "nudged"], "missed", {});
