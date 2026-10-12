import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth";

/** Columns every profile table shares, so the three tables below can't drift apart. */
const common = () => ({
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  sourceType: text("source_type").notNull().default("manual"),
  sourceId: text("source_id"),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

const sourceCheck = (name: string, col: { name: string }) =>
  check(name, sql.raw(`"${col.name}" in ('cv','linkedin','message','checkin','manual')`));

export const experiences = pgTable(
  "experiences",
  {
    ...common(),
    title: text("title").notNull(),
    organization: text("organization"),
    startDate: text("start_date"),
    endDate: text("end_date"),
    description: text("description"),
    highlights: jsonb("highlights").$type<string[]>().notNull().default([]),
  },
  (t) => [
    index("experiences_user_id_idx").on(t.userId),
    sourceCheck("experiences_source_type", t.sourceType),
  ],
);

export const education = pgTable(
  "education",
  {
    ...common(),
    institution: text("institution").notNull(),
    qualification: text("qualification"),
    field: text("field"),
    startDate: text("start_date"),
    endDate: text("end_date"),
  },
  (t) => [
    index("education_user_id_idx").on(t.userId),
    sourceCheck("education_source_type", t.sourceType),
  ],
);

export const skills = pgTable(
  "skills",
  {
    ...common(),
    name: text("name").notNull(),
    level: text("level"),
    // No FK: a replace-all taxonomy import would cascade or block. Dangling links are nulled after import.
    taxonomySkillId: text("taxonomy_skill_id"),
    evidence: text("evidence"),
  },
  (t) => [
    index("skills_user_id_idx").on(t.userId),
    sourceCheck("skills_source_type", t.sourceType),
    check(
      "skills_level",
      sql`${t.level} is null or ${t.level} in ('basic','working','strong','expert')`,
    ),
  ],
);
