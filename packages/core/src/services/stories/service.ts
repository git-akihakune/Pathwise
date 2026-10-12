import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { type DbOrTx, schema } from "../../db";
import { NotFoundError } from "../../errors";
import { SOURCES, type SourceType } from "../profile";
import { deleteOwned, updateVersioned } from "../versioned";

export interface Story {
  id: string;
  title: string;
  situation: string;
  task: string;
  action: string;
  result: string;
  metrics: string | null;
  skills: string[];
  sourceType: SourceType;
  sourceId: string | null;
  version: number;
}

const body = z.string().max(4000);
const skills = z
  .array(z.string().trim().min(1).max(100))
  .max(20)
  .transform((list) => {
    const seen = new Set<string>();
    return list.filter((s) => !seen.has(s.toLowerCase()) && seen.add(s.toLowerCase()));
  });

const fields = {
  title: z.string().trim().min(1, "Enter a title.").max(200),
  situation: body,
  task: body,
  action: body,
  result: body,
  metrics: z.string().max(500).nullable(),
  skills,
};

export const storyInputSchema = z.object({
  title: fields.title,
  situation: fields.situation.default(""),
  task: fields.task.default(""),
  action: fields.action.default(""),
  result: fields.result.default(""),
  metrics: fields.metrics.default(null),
  skills: fields.skills.default([]),
});
export type StoryInput = z.input<typeof storyInputSchema>;

// No defaults here: a patch must leave unmentioned fields alone.
export const storyPatchSchema = z.object(fields).partial();
const provenanceSchema = z.object({
  sourceType: z.enum(SOURCES).default("manual"),
  sourceId: z.string().max(200).nullish(),
});

type StoryRow = typeof schema.stories.$inferSelect;
const toStory = ({ embedding: _e, embeddingModel: _m, search: _s, ...story }: StoryRow) =>
  story as Story;

export async function listStories(db: DbOrTx, userId: string): Promise<Story[]> {
  const s = schema.stories;
  const rows = await db
    .select()
    .from(s)
    .where(eq(s.userId, userId))
    .orderBy(desc(s.createdAt), desc(s.id));
  return rows.map(toStory);
}

export async function getStory(db: DbOrTx, userId: string, id: string): Promise<Story> {
  const s = schema.stories;
  if (!z.string().uuid().safeParse(id).success) throw new NotFoundError("Not found.");
  const [row] = await db
    .select()
    .from(s)
    .where(and(eq(s.id, id), eq(s.userId, userId)));
  if (!row) throw new NotFoundError("Not found.");
  return toStory(row);
}

export async function createStory(
  db: DbOrTx,
  userId: string,
  input: StoryInput & { sourceType?: SourceType; sourceId?: string | null },
): Promise<Story> {
  const values = storyInputSchema.parse(input);
  const provenance = provenanceSchema.parse(input);
  const [row] = await db
    .insert(schema.stories)
    .values({ ...values, sourceId: null, ...provenance, userId })
    .returning();
  return toStory(row as StoryRow);
}

export async function updateStory(
  db: DbOrTx,
  userId: string,
  id: string,
  patch: Partial<StoryInput>,
  expectedVersion?: number,
): Promise<Story> {
  const set = storyPatchSchema.parse(patch);
  const row = await updateVersioned(
    db,
    schema.stories,
    userId,
    id,
    Object.keys(set).length > 0 ? { ...set, embedding: null, embeddingModel: null } : set,
    expectedVersion,
  );
  return toStory(row);
}

export async function deleteStory(db: DbOrTx, userId: string, id: string): Promise<void> {
  await deleteOwned(db, schema.stories, userId, id);
}
