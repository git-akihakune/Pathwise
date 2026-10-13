import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  check,
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
import { workflowRuns } from "./workflows";

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    topic: text("topic"),
    summary: text("summary"),
    summarySearch: tsvector("summary_search").generatedAlwaysAs(
      sql`to_tsvector('english', coalesce("summary", ''))`,
    ),
    summaryEmbedding: anyVector("summary_embedding"),
    summaryEmbeddingModel: text("summary_embedding_model"),
    summarizedThroughMessageId: uuid("summarized_through_message_id").references(
      (): AnyPgColumn => messages.id,
      { onDelete: "set null" },
    ),
    curatedThroughMessageId: uuid("curated_through_message_id").references(
      (): AnyPgColumn => messages.id,
      { onDelete: "set null" },
    ),
    workflowRunId: uuid("workflow_run_id").references(() => workflowRuns.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("sessions_user_last_message_idx").on(t.userId, t.lastMessageAt),
    index("sessions_summary_search_idx").using("gin", t.summarySearch),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    seq: bigint("seq", { mode: "number" }).generatedAlwaysAsIdentity(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    parts: jsonb("parts").notNull(),
    status: text("status").notNull().default("complete"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    skills: text("skills").array().notNull().default(sql`'{}'`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("messages_session_seq_idx").on(t.sessionId, t.seq),
    check("messages_role", sql`${t.role} in ('user', 'assistant')`),
    check("messages_status", sql`${t.status} in ('complete', 'interrupted')`),
  ],
);

export const userSnapshot = pgTable("user_snapshot", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  profileVersion: integer("profile_version").notNull(),
  generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
