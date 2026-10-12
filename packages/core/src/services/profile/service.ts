import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { type DbOrTx, schema } from "../../db";
import { matchTaxonomySkill } from "../../taxonomy";
import { deleteOwned, updateVersioned } from "../versioned";
import { bumpProfileVersion } from "./version";

export type SourceType = "cv" | "linkedin" | "message" | "checkin" | "manual";
export type SkillLevel = "basic" | "working" | "strong" | "expert";

interface Provenance {
  sourceType: SourceType;
  sourceId: string | null;
  version: number;
}
export interface Experience extends Provenance {
  id: string;
  title: string;
  organization: string | null;
  startDate: string | null;
  endDate: string | null;
  description: string | null;
  highlights: string[];
}
export interface Education extends Provenance {
  id: string;
  institution: string;
  qualification: string | null;
  field: string | null;
  startDate: string | null;
  endDate: string | null;
}
export interface Skill extends Provenance {
  id: string;
  name: string;
  level: SkillLevel | null;
  taxonomySkillId: string | null;
  evidence: string | null;
}
export interface Profile {
  experiences: Experience[];
  education: Education[];
  skills: Skill[];
}

export const SOURCES = ["cv", "linkedin", "message", "checkin", "manual"] as const;
const text = (max: number) => z.string().trim().max(max).nullish();
const required = (message: string) => z.string().trim().min(1, message).max(200);
const partialDate = z
  .string()
  .regex(/^\d{4}(-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?)?$/, "Use YYYY, YYYY-MM or YYYY-MM-DD.")
  .nullish();
const provenance = {
  sourceType: z.enum(SOURCES).default("manual"),
  sourceId: z.string().max(200).nullish(),
};

const dates = { startDate: partialDate, endDate: partialDate };
const rangeOk = (d: { startDate?: string | null; endDate?: string | null }) =>
  !d.startDate || !d.endDate || d.endDate.padEnd(10, "9") >= d.startDate;
const RANGE_ISSUE = { message: "End date is before start date.", path: ["endDate"] };
const dateRangeSchema = z.object(dates).refine(rangeOk, RANGE_ISSUE);

const experienceBase = z.object({
  title: required("Enter a title."),
  organization: text(200),
  ...dates,
  description: text(4000),
  highlights: z.array(z.string().trim().min(1).max(4000)).max(20),
  ...provenance,
});
const educationBase = z.object({
  institution: required("Enter an institution."),
  qualification: text(200),
  field: text(200),
  ...dates,
  ...provenance,
});
// Defaults belong only on the create schemas: .partial() keeps them and would overwrite stored values.
export const experienceInputSchema = experienceBase
  .extend({ highlights: experienceBase.shape.highlights.default([]) })
  .refine(rangeOk, RANGE_ISSUE);
export const educationInputSchema = educationBase.refine(rangeOk, RANGE_ISSUE);
export const skillInputSchema = z.object({
  name: required("Enter a skill."),
  level: z.enum(["basic", "working", "strong", "expert"]).nullish(),
  taxonomySkillId: z.string().max(200).nullish(),
  evidence: text(4000),
  ...provenance,
});
export type ExperienceInput = z.input<typeof experienceInputSchema>;
export type EducationInput = z.input<typeof educationInputSchema>;
export type SkillInput = z.input<typeof skillInputSchema>;

type Patch<I> = Partial<Omit<I, "sourceType" | "sourceId">>;
const omitProvenance = { sourceType: true, sourceId: true } as const;
export const experiencePatchSchema = experienceBase.omit(omitProvenance).partial();
export const educationPatchSchema = educationBase.omit(omitProvenance).partial();
export const skillPatchSchema = skillInputSchema.omit(omitProvenance).partial();

const currentFirst = <T extends typeof schema.experiences | typeof schema.education>(t: T) => [
  desc(sql`${t.endDate} is null`),
  sql`${t.startDate} desc nulls last`,
  desc(t.createdAt),
  asc(t.id),
];

export async function getProfile(db: DbOrTx, userId: string): Promise<Profile> {
  const { experiences: ex, education: ed, skills: sk } = schema;
  const [experiences, education, skills] = await Promise.all([
    db
      .select()
      .from(ex)
      .where(eq(ex.userId, userId))
      .orderBy(...currentFirst(ex)),
    db
      .select()
      .from(ed)
      .where(eq(ed.userId, userId))
      .orderBy(...currentFirst(ed)),
    db.select().from(sk).where(eq(sk.userId, userId)).orderBy(sql`lower(${sk.name})`, asc(sk.id)),
  ]);
  return { experiences, education, skills } as Profile;
}

/** Runs one profile write and the profile_version bump atomically. */
function write<T>(db: DbOrTx, userId: string, fn: (tx: DbOrTx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    const result = await fn(tx);
    await bumpProfileVersion(tx, userId);
    return result;
  });
}

/** Validates the dates a patch would produce once merged with the stored row. */
async function checkMergedDates(
  db: DbOrTx,
  table: typeof schema.experiences | typeof schema.education,
  userId: string,
  id: string,
  patch: { startDate?: string | null; endDate?: string | null },
): Promise<void> {
  if (patch.startDate === undefined && patch.endDate === undefined) return;
  const [stored] = await db
    .select({ startDate: table.startDate, endDate: table.endDate })
    .from(table)
    .where(and(eq(table.id, id), eq(table.userId, userId)));
  if (stored) dateRangeSchema.parse({ ...stored, ...patch });
}

export async function createExperience(
  db: DbOrTx,
  userId: string,
  input: ExperienceInput,
): Promise<Experience> {
  const values = experienceInputSchema.parse(input);
  return write(db, userId, async (tx) => {
    const [row] = await tx
      .insert(schema.experiences)
      .values({ ...values, userId })
      .returning();
    return row as Experience;
  });
}

export async function updateExperience(
  db: DbOrTx,
  userId: string,
  id: string,
  patch: Patch<ExperienceInput>,
  expectedVersion?: number,
): Promise<Experience> {
  const set = experiencePatchSchema.parse(patch);
  return write(db, userId, async (tx) => {
    await checkMergedDates(tx, schema.experiences, userId, id, set);
    return (await updateVersioned(
      tx,
      schema.experiences,
      userId,
      id,
      set,
      expectedVersion,
    )) as Experience;
  });
}

export function deleteExperience(db: DbOrTx, userId: string, id: string): Promise<void> {
  return write(db, userId, (tx) => deleteOwned(tx, schema.experiences, userId, id));
}

export async function createEducation(
  db: DbOrTx,
  userId: string,
  input: EducationInput,
): Promise<Education> {
  const values = educationInputSchema.parse(input);
  return write(db, userId, async (tx) => {
    const [row] = await tx
      .insert(schema.education)
      .values({ ...values, userId })
      .returning();
    return row as Education;
  });
}

export async function updateEducation(
  db: DbOrTx,
  userId: string,
  id: string,
  patch: Patch<EducationInput>,
  expectedVersion?: number,
): Promise<Education> {
  const set = educationPatchSchema.parse(patch);
  return write(db, userId, async (tx) => {
    await checkMergedDates(tx, schema.education, userId, id, set);
    return (await updateVersioned(
      tx,
      schema.education,
      userId,
      id,
      set,
      expectedVersion,
    )) as Education;
  });
}

export function deleteEducation(db: DbOrTx, userId: string, id: string): Promise<void> {
  return write(db, userId, (tx) => deleteOwned(tx, schema.education, userId, id));
}

/** A caller-supplied link is kept only if it exists; otherwise the name is matched exactly. */
async function resolveLink(
  db: DbOrTx,
  name: string,
  given: string | null | undefined,
): Promise<string | null> {
  if (given === undefined) return matchTaxonomySkill(db, name);
  if (given === null) return null;
  const [hit] = await db
    .select({ id: schema.taxonomySkills.id })
    .from(schema.taxonomySkills)
    .where(eq(schema.taxonomySkills.id, given));
  return hit?.id ?? null;
}

export async function createSkill(db: DbOrTx, userId: string, input: SkillInput): Promise<Skill> {
  const values = skillInputSchema.parse(input);
  return write(db, userId, async (tx) => {
    const taxonomySkillId = await resolveLink(tx, values.name, values.taxonomySkillId);
    const [row] = await tx
      .insert(schema.skills)
      .values({ ...values, taxonomySkillId, userId })
      .returning();
    return row as Skill;
  });
}

export async function updateSkill(
  db: DbOrTx,
  userId: string,
  id: string,
  patch: Patch<SkillInput>,
  expectedVersion?: number,
): Promise<Skill> {
  const set = skillPatchSchema.parse(patch);
  return write(db, userId, async (tx) => {
    const { name, taxonomySkillId: given } = set;
    let link: string | null | undefined;
    if (given !== undefined) {
      link = await resolveLink(tx, name ?? "", given);
    } else if (name !== undefined) {
      const [stored] = await tx
        .select({ name: schema.skills.name })
        .from(schema.skills)
        .where(and(eq(schema.skills.id, id), eq(schema.skills.userId, userId)));
      if (stored && stored.name !== name) link = await matchTaxonomySkill(tx, name);
    }
    return (await updateVersioned(
      tx,
      schema.skills,
      userId,
      id,
      { ...set, taxonomySkillId: link },
      expectedVersion,
    )) as Skill;
  });
}

export function deleteSkill(db: DbOrTx, userId: string, id: string): Promise<void> {
  return write(db, userId, (tx) => deleteOwned(tx, schema.skills, userId, id));
}
