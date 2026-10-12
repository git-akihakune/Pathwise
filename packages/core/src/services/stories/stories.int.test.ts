import { eq, sql } from "drizzle-orm";
import { beforeEach, expect, it } from "vitest";
import { ZodError } from "zod";
import { getTestDb, resetDb } from "../../../../../test/integration/db";
import { seedUser } from "../../../../../test/integration/fixtures";
import { schema } from "../../db";
import { ConflictError, NotFoundError } from "../../errors";
import { createStory, deleteStory, getStory, listStories, updateStory } from ".";

const db = getTestDb();
const STORY = {
  title: "Cut report time by 80%",
  situation: "Weekly report took 2 days.",
  task: "Speed it up.",
  action: "Automated it with SQL and Python.",
  result: "Takes 3 hours.",
  metrics: "80% faster",
  skills: ["SQL", " sql ", "Python"],
};
beforeEach(async () => {
  await resetDb(db);
  await seedUser(db, "u1");
  await seedUser(db, "u2");
});

it("creates, normalizes skills, and finds stories by skill in full text", async () => {
  const s = await createStory(db, "u1", STORY);
  expect(s).toMatchObject({ skills: ["SQL", "Python"], sourceType: "manual", version: 1 });
  const hit = await db.execute(
    sql`select id from stories where search @@ websearch_to_tsquery('english', 'python')`,
  );
  expect(hit.rows).toEqual([{ id: s.id }]);
  await expect(createStory(db, "u1", { ...STORY, title: " " })).rejects.toBeInstanceOf(ZodError);
});

it("applies defaults on create only", async () => {
  const s = await createStory(db, "u1", { title: "Bare" });
  expect(s).toMatchObject({ situation: "", result: "", metrics: null, skills: [] });
});

it("versions updates and clears the embedding when text changes", async () => {
  const s = await createStory(db, "u1", STORY);
  await db
    .update(schema.stories)
    .set({ embedding: [1, 0], embeddingModel: "m1" })
    .where(eq(schema.stories.id, s.id));
  expect(await updateStory(db, "u1", s.id, { result: "Takes 2 hours." }, 1)).toMatchObject({
    version: 2,
    result: "Takes 2 hours.",
  });
  const [row] = await db.select().from(schema.stories).where(eq(schema.stories.id, s.id));
  expect(row).toMatchObject({ embedding: null, embeddingModel: null });
  await expect(updateStory(db, "u1", s.id, { title: "x" }, 1)).rejects.toBeInstanceOf(
    ConflictError,
  );
});

it("patching one field leaves the others unchanged", async () => {
  const s = await createStory(db, "u1", STORY);
  const u = await updateStory(db, "u1", s.id, { title: "New title" });
  expect(u).toMatchObject({ ...s, updatedAt: expect.any(Date), title: "New title", version: 2 });
});

it("lists newest first", async () => {
  const a = await createStory(db, "u1", { title: "A" });
  const b = await createStory(db, "u1", { title: "B" });
  expect((await listStories(db, "u1")).map((x) => x.id)).toEqual([b.id, a.id]);
});

it("isolates users", async () => {
  const s = await createStory(db, "u1", STORY);
  expect(await listStories(db, "u2")).toEqual([]);
  await expect(getStory(db, "u2", s.id)).rejects.toBeInstanceOf(NotFoundError);
  await expect(deleteStory(db, "u2", s.id)).rejects.toBeInstanceOf(NotFoundError);
  await deleteStory(db, "u1", s.id);
  expect(await listStories(db, "u1")).toEqual([]);
});
