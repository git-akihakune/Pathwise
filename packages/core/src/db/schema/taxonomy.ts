import { sql } from "drizzle-orm";
import {
  check,
  doublePrecision,
  index,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { anyVector, tsvector } from "./columns";

export const occupations = pgTable(
  "occupations",
  {
    id: text("id").primaryKey(),
    source: text("source").notNull(),
    code: text("code").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    altTitles: text("alt_titles").array().notNull().default(sql`'{}'`),
    tasks: text("tasks").array().notNull().default(sql`'{}'`),
    embedding: anyVector("embedding"),
    embeddingModel: text("embedding_model"),
    search: tsvector("search").generatedAlwaysAs(
      sql`setweight(to_tsvector('english', "title"), 'A') || setweight(to_tsvector('english', immutable_array_to_string("alt_titles", ' ')), 'B') || setweight(to_tsvector('english', "description"), 'C')`,
    ),
  },
  (t) => [
    unique("occupations_source_code_unique").on(t.source, t.code),
    index("occupations_search_idx").using("gin", t.search),
    check("occupations_source", sql`${t.source} in ('onet','esco')`),
  ],
);

export const taxonomySkills = pgTable(
  "taxonomy_skills",
  {
    id: text("id").primaryKey(),
    source: text("source").notNull(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    search: tsvector("search").generatedAlwaysAs(
      sql`setweight(to_tsvector('english', "name"), 'A') || setweight(to_tsvector('english', "description"), 'B')`,
    ),
  },
  (t) => [
    unique("taxonomy_skills_source_code_unique").on(t.source, t.code),
    index("taxonomy_skills_search_idx").using("gin", t.search),
    index("taxonomy_skills_lower_name_idx").on(sql`lower(${t.name})`),
    check("taxonomy_skills_source", sql`${t.source} in ('onet','esco')`),
  ],
);

export const occupationSkills = pgTable(
  "occupation_skills",
  {
    occupationId: text("occupation_id")
      .notNull()
      .references(() => occupations.id, { onDelete: "cascade" }),
    taxonomySkillId: text("taxonomy_skill_id")
      .notNull()
      .references(() => taxonomySkills.id, { onDelete: "cascade" }),
    importance: doublePrecision("importance").notNull(),
    level: doublePrecision("level"),
  },
  (t) => [
    primaryKey({ columns: [t.occupationId, t.taxonomySkillId] }),
    index("occupation_skills_skill_idx").on(t.taxonomySkillId),
    check("occupation_skills_importance", sql`${t.importance} between 0 and 1`),
  ],
);

export const occupationRelations = pgTable(
  "occupation_relations",
  {
    fromId: text("from_id")
      .notNull()
      .references(() => occupations.id, { onDelete: "cascade" }),
    toId: text("to_id")
      .notNull()
      .references(() => occupations.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.fromId, t.toId, t.kind] }),
    check("occupation_relations_kind", sql`${t.kind} in ('related','crosswalk')`),
  ],
);

export const taxonomyMeta = pgTable(
  "taxonomy_meta",
  {
    id: smallint("id").primaryKey().default(1),
    version: text("version").notNull(),
    importedAt: timestamp("imported_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("taxonomy_meta_singleton", sql`${t.id} = 1`)],
);
