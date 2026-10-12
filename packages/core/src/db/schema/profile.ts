import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { anyVector, tsvector } from "./columns";

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

export const memoryItems = pgTable(
  "memory_items",
  {
    ...common(),
    // clock_timestamp() so items added in one transaction still sort newest-first.
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
    category: text("category").notNull(),
    content: text("content").notNull(),
    confidence: doublePrecision("confidence").notNull().default(1),
    sensitive: boolean("sensitive").notNull().default(false),
    status: text("status").notNull().default("active"),
    supersedesId: uuid("supersedes_id").references((): AnyPgColumn => memoryItems.id, {
      onDelete: "set null",
    }),
    embedding: anyVector("embedding"),
    embeddingModel: text("embedding_model"),
    search: tsvector("search").generatedAlwaysAs(sql`to_tsvector('english', "content")`),
  },
  (t) => [
    index("memory_items_user_status_idx").on(t.userId, t.status),
    index("memory_items_search_idx").using("gin", t.search),
    sourceCheck("memory_items_source_type", t.sourceType),
    check(
      "memory_items_category",
      sql`${t.category} in ('value','constraint','aspiration','energizer','drain','preference','fact','event','observation')`,
    ),
    check("memory_items_confidence", sql`${t.confidence} >= 0 and ${t.confidence} <= 1`),
    check("memory_items_status", sql`${t.status} in ('active','pending','rejected','superseded')`),
  ],
);
