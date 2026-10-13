import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";

export const WORKFLOW_TYPES = ["onboarding", "checkin"] as const;
export const RUN_STATUSES = ["active", "needs_attention", "completed", "abandoned"] as const;

// Literal values, not bind parameters: DDL can't carry parameters.
const inList = (column: unknown, values: readonly string[]) =>
  sql`${column} in (${sql.raw(values.map((v) => `'${v}'`).join(", "))})`;

export const workflowRuns = pgTable(
  "workflow_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    stepId: text("step_id").notNull(),
    state: jsonb("state").notNull().default(sql`'{}'::jsonb`),
    status: text("status").notNull().default("active"),
    runningSince: timestamp("running_since", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("workflow_runs_type", inList(t.type, WORKFLOW_TYPES)),
    check("workflow_runs_status", inList(t.status, RUN_STATUSES)),
    uniqueIndex("workflow_runs_one_open")
      .on(t.userId, t.type)
      .where(sql`${t.status} in ('active', 'needs_attention')`),
    index("workflow_runs_user_type_idx").on(t.userId, t.type, t.createdAt),
  ],
);

export const DOCUMENT_KINDS = ["cv", "linkedin", "other"] as const;
export const DOCUMENT_MIMES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
] as const;
export const DOCUMENT_STATUSES = ["pending", "parsed", "failed"] as const;

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    filename: text("filename").notNull(),
    mime: text("mime").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    /** `<userId>/<uuid>` relative to FILES_DIR; null for pasted text. */
    storagePath: text("storage_path"),
    extractedText: text("extracted_text"),
    /** DocumentExtraction (Task 4). */
    extraction: jsonb("extraction").$type<unknown>(),
    status: text("status").notNull().default("pending"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("documents_kind", inList(t.kind, DOCUMENT_KINDS)),
    check("documents_mime", inList(t.mime, DOCUMENT_MIMES)),
    check("documents_status", inList(t.status, DOCUMENT_STATUSES)),
    index("documents_user_idx").on(t.userId, t.createdAt),
  ],
);

export const CHECKIN_STATUSES = ["scheduled", "sent", "nudged", "completed", "missed"] as const;

export const checkins = pgTable(
  "checkins",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    weekOf: date("week_of", { mode: "string" }).notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    workflowRunId: uuid("workflow_run_id").references(() => workflowRuns.id, {
      onDelete: "set null",
    }),
    energy: smallint("energy"),
    summary: text("summary"),
    status: text("status").notNull().default("scheduled"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    nudgedAt: timestamp("nudged_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("checkins_energy", sql`${t.energy} between 1 and 5`),
    check("checkins_status", inList(t.status, CHECKIN_STATUSES)),
    uniqueIndex("checkins_user_week").on(t.userId, t.weekOf),
    index("checkins_user_due_idx").on(t.userId, t.dueAt),
  ],
);
