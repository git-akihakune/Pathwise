import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getTestDb, resetDb } from "../../../../../test/integration/db";
import { seedUser } from "../../../../../test/integration/fixtures";
import { schema } from "../../db";
import { ConflictError, NotFoundError } from "../../errors";
import { getUserSettings } from "../settings";
import {
  addMemory,
  deleteMemory,
  listMemory,
  PROFILE_MEMORY_CATEGORIES,
  setMemoryStatus,
  updateMemory,
} from ".";

const db = getTestDb();
const pv = async () => (await getUserSettings(db, "u1")).profileVersion;
const mem = (content: string, over: Partial<Parameters<typeof addMemory>[2]> = {}) =>
  addMemory(db, "u1", {
    category: "value",
    content,
    sourceType: "manual",
    sourceId: null,
    confidence: 1,
    sensitive: false,
    status: "active",
    ...over,
  });
const row = async (id: string) => {
  const [r] = await db.select().from(schema.memoryItems).where(eq(schema.memoryItems.id, id));
  return r;
};
beforeEach(async () => {
  await resetDb(db);
  await seedUser(db, "u1");
  await seedUser(db, "u2");
});

describe("memory", () => {
  it("lists only active items by default and filters by category", async () => {
    await mem("Autonomy");
    await mem("Has two kids", { category: "constraint", status: "pending", sensitive: true });
    await mem("Hates commuting", { category: "drain" });
    expect((await listMemory(db, "u1")).map((m) => m.content)).toEqual([
      "Hates commuting",
      "Autonomy",
    ]);
    expect((await listMemory(db, "u1", { status: ["pending"] })).map((m) => m.content)).toEqual([
      "Has two kids",
    ]);
    expect((await listMemory(db, "u1", { categories: ["drain"] })).map((m) => m.content)).toEqual([
      "Hates commuting",
    ]);
    expect(await listMemory(db, "u2")).toEqual([]);
  });

  it("bumps profile_version only when the active set changes", async () => {
    const p = await mem("Pending thing", { status: "pending" });
    expect(await pv()).toBe(0);
    await setMemoryStatus(db, "u1", p.id, "active");
    expect(await pv()).toBe(1);
    await expect(setMemoryStatus(db, "u1", p.id, "rejected")).rejects.toBeInstanceOf(ConflictError);
    const q = await mem("Another", { status: "pending" });
    await setMemoryStatus(db, "u1", q.id, "rejected");
    expect(await pv()).toBe(1);
  });

  it("supersedes the old item", async () => {
    const old = await mem("Salary floor 50k", { category: "constraint" });
    const next = await mem("Salary floor 60k", { category: "constraint", supersedesId: old.id });
    expect(next.supersedesId).toBe(old.id);
    expect((await listMemory(db, "u1")).map((m) => m.content)).toEqual(["Salary floor 60k"]);
    expect((await listMemory(db, "u1", { status: ["superseded"] }))[0]).toMatchObject({
      id: old.id,
      version: 2,
    });
    const theirs = await addMemory(db, "u2", {
      category: "value",
      content: "x",
      sourceType: "manual",
      sourceId: null,
      confidence: 1,
      sensitive: false,
      status: "active",
    });
    await expect(mem("y", { supersedesId: theirs.id })).rejects.toBeInstanceOf(NotFoundError);
    await expect(mem("z", { supersedesId: old.id })).rejects.toBeInstanceOf(ConflictError);
  });

  it("clears the embedding when content changes, but not for a category change", async () => {
    const m = await mem("Remote work");
    await db
      .update(schema.memoryItems)
      .set({ embedding: [0.1, 0.2, 0.3], embeddingModel: "m1" })
      .where(eq(schema.memoryItems.id, m.id));
    await updateMemory(db, "u1", m.id, { category: "preference" });
    expect(await row(m.id)).toMatchObject({
      content: "Remote work",
      category: "preference",
      embedding: [0.1, 0.2, 0.3],
      embeddingModel: "m1",
      version: 2,
    });
    await updateMemory(db, "u1", m.id, { content: "Fully remote work" }, 2);
    expect(await row(m.id)).toMatchObject({
      category: "preference",
      embedding: null,
      embeddingModel: null,
      version: 3,
    });
    const hit = await db.execute(
      sql`select 1 from memory_items where search @@ websearch_to_tsquery('english', 'remote')`,
    );
    expect(hit.rows).toHaveLength(1);
  });

  it("leaves other fields unchanged when patching one, and rejects stale versions", async () => {
    const m = await mem("Autonomy", { confidence: 0.4, sensitive: true });
    await updateMemory(db, "u1", m.id, { content: "Autonomy at work" });
    expect(await row(m.id)).toMatchObject({
      category: "value",
      confidence: 0.4,
      sensitive: true,
      status: "active",
    });
    await expect(updateMemory(db, "u1", m.id, { category: "drain" }, 1)).rejects.toBeInstanceOf(
      ConflictError,
    );
    await expect(updateMemory(db, "u2", m.id, { category: "drain" })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("deletes and isolates", async () => {
    const m = await mem("Autonomy");
    await expect(deleteMemory(db, "u2", m.id)).rejects.toBeInstanceOf(NotFoundError);
    await deleteMemory(db, "u1", m.id);
    expect(await listMemory(db, "u1")).toEqual([]);
    expect(await pv()).toBe(2);
  });

  it("exposes the Profile categories", () => {
    expect(PROFILE_MEMORY_CATEGORIES).toEqual([
      "value",
      "constraint",
      "aspiration",
      "energizer",
      "drain",
      "preference",
    ]);
  });
});
