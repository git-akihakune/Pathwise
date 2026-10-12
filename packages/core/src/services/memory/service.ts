import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { type DbOrTx, schema } from "../../db";
import { ConflictError, NotFoundError } from "../../errors";
import { bumpProfileVersion, type SourceType } from "../profile";
import { deleteOwned, updateVersioned } from "../versioned";

export const MEMORY_CATEGORIES = [
  "value",
  "constraint",
  "aspiration",
  "energizer",
  "drain",
  "preference",
  "fact",
  "event",
  "observation",
] as const;
export const MEMORY_STATUSES = ["active", "pending", "rejected", "superseded"] as const;
export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];
export type MemoryStatus = (typeof MEMORY_STATUSES)[number];

/** The categories shown on the Profile screen. */
export const PROFILE_MEMORY_CATEGORIES: MemoryCategory[] = [
  "value",
  "constraint",
  "aspiration",
  "energizer",
  "drain",
  "preference",
];

export interface MemoryItem {
  id: string;
  category: MemoryCategory;
  content: string;
  sourceType: SourceType;
  sourceId: string | null;
  confidence: number;
  sensitive: boolean;
  status: MemoryStatus;
  supersedesId: string | null;
  version: number;
  createdAt: Date;
}

const content = z.string().trim().min(1, "Enter something to remember.").max(1000);
const category = z.enum(MEMORY_CATEGORIES);

export const memoryInputSchema = z.object({
  category,
  content,
  sourceType: z.enum(["cv", "linkedin", "message", "checkin", "manual"]),
  sourceId: z.string().max(200).nullable(),
  confidence: z.number().min(0).max(1),
  sensitive: z.boolean(),
  status: z.enum(MEMORY_STATUSES),
  supersedesId: z.string().optional(),
});
export type MemoryInput = z.input<typeof memoryInputSchema>;

// No defaults here: a patch must leave unmentioned fields alone.
const memoryPatchSchema = z.object({ content, category }).partial();

const toItem = ({ embedding: _e, embeddingModel: _m, search: _s, ...item }: MemoryRow) =>
  item as MemoryItem;
type MemoryRow = typeof schema.memoryItems.$inferSelect;

export async function listMemory(
  db: DbOrTx,
  userId: string,
  filter: { status?: MemoryStatus[]; categories?: MemoryCategory[] } = {},
): Promise<MemoryItem[]> {
  const m = schema.memoryItems;
  const rows = await db
    .select()
    .from(m)
    .where(
      and(
        eq(m.userId, userId),
        inArray(m.status, filter.status ?? ["active"]),
        filter.categories ? inArray(m.category, filter.categories) : undefined,
      ),
    )
    .orderBy(desc(m.createdAt), desc(m.id));
  return rows.map(toItem);
}

/** Loads and locks one of the user's rows; a missing or foreign row is a `NotFoundError`. */
async function lockOwned(db: DbOrTx, userId: string, id: string): Promise<MemoryRow> {
  const m = schema.memoryItems;
  const [row] = await db
    .select()
    .from(m)
    .where(and(eq(m.id, id), eq(m.userId, userId)))
    .for("update");
  if (!row) throw new NotFoundError("Not found.");
  return row;
}

export async function addMemory(
  db: DbOrTx,
  userId: string,
  input: MemoryInput,
): Promise<MemoryItem> {
  const { supersedesId, ...values } = memoryInputSchema.parse(input);
  return db.transaction(async (tx) => {
    if (supersedesId) {
      const old = await lockOwned(tx, userId, supersedesId);
      if (old.status !== "active") throw new ConflictError("That item is no longer active.");
      // A pending replacement supersedes only once it is confirmed (see setMemoryStatus).
      if (values.status === "active") {
        await updateVersioned(tx, schema.memoryItems, userId, old.id, { status: "superseded" });
      }
    }
    const [row] = await tx
      .insert(schema.memoryItems)
      .values({ ...values, supersedesId: supersedesId ?? null, userId })
      .returning();
    if (values.status === "active") await bumpProfileVersion(tx, userId);
    return toItem(row as MemoryRow);
  });
}

export async function updateMemory(
  db: DbOrTx,
  userId: string,
  id: string,
  patch: { content?: string; category?: MemoryCategory },
  expectedVersion?: number,
): Promise<MemoryItem> {
  const set = memoryPatchSchema.parse(patch);
  return db.transaction(async (tx) => {
    const row = await updateVersioned(
      tx,
      schema.memoryItems,
      userId,
      id,
      set.content === undefined ? set : { ...set, embedding: null, embeddingModel: null },
      expectedVersion,
    );
    if (row.status === "active") await bumpProfileVersion(tx, userId);
    return toItem(row);
  });
}

/** Confirms or dismisses a pending item. */
export async function setMemoryStatus(
  db: DbOrTx,
  userId: string,
  id: string,
  status: "active" | "rejected",
): Promise<void> {
  await db.transaction(async (tx) => {
    const row = await lockOwned(tx, userId, id);
    if (row.status !== "pending") {
      throw new ConflictError("Only pending items can be confirmed or dismissed.");
    }
    await updateVersioned(tx, schema.memoryItems, userId, id, { status });
    if (status === "active") {
      if (row.supersedesId) {
        const old = await lockOwned(tx, userId, row.supersedesId).catch((e) => {
          if (e instanceof NotFoundError) return null;
          throw e;
        });
        if (old?.status === "active") {
          await updateVersioned(tx, schema.memoryItems, userId, old.id, { status: "superseded" });
        }
      }
      await bumpProfileVersion(tx, userId);
    }
  });
}

export async function deleteMemory(db: DbOrTx, userId: string, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const row = await lockOwned(tx, userId, id);
    await deleteOwned(tx, schema.memoryItems, userId, id);
    if (row.status === "active") await bumpProfileVersion(tx, userId);
  });
}
