import { and, eq, sql } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import type { DbOrTx } from "../db";
import { ConflictError, NotFoundError } from "../errors";

/** A user-owned table with optimistic versioning. */
export type VersionedTable = PgTable & {
  id: PgColumn;
  userId: PgColumn;
  version: PgColumn;
  updatedAt: PgColumn;
};

/**
 * Updates one of the user's rows, bumping `version` and `updated_at`. With `expectedVersion`, only a
 * row at that version matches. A miss is a `ConflictError` if the row exists, else a `NotFoundError`
 * (another user's row counts as missing). Call it inside the transaction that holds the other writes.
 */
export async function updateVersioned<T extends VersionedTable>(
  db: DbOrTx,
  table: T,
  userId: string,
  id: string,
  set: Partial<T["$inferInsert"]>,
  expectedVersion?: number,
): Promise<T["$inferSelect"]> {
  const t: VersionedTable = table;
  const owned = and(eq(t.id, id), eq(t.userId, userId));
  const [row] = await db
    .update(t)
    .set({ ...set, version: sql`${t.version} + 1`, updatedAt: sql`now()` })
    .where(expectedVersion === undefined ? owned : and(owned, eq(t.version, expectedVersion)))
    .returning();
  if (row) return row as T["$inferSelect"];
  const [exists] = await db.select({ id: t.id }).from(t).where(owned);
  if (!exists) throw new NotFoundError("Not found.");
  throw new ConflictError("This item changed since you loaded it.");
}

/** Deletes one of the user's rows; a missing or foreign row is a `NotFoundError`. */
export async function deleteOwned(
  db: DbOrTx,
  table: VersionedTable,
  userId: string,
  id: string,
): Promise<void> {
  const rows = await db
    .delete(table)
    .where(and(eq(table.id, id), eq(table.userId, userId)))
    .returning({ id: table.id });
  if (rows.length === 0) throw new NotFoundError("Not found.");
}
