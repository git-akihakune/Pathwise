import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth";

export const PROPOSAL_KINDS = [
  "profile_update",
  "memory_add",
  "memory_update",
  "story_add",
  "story_update",
  "path_save",
  "plan_create",
  "plan_change",
  "action_status_update",
] as const;
export const PROPOSAL_STATUSES = ["pending", "approved", "rejected", "conflicted"] as const;

// Literal values, not bind parameters: DDL can't carry parameters.
const inList = (column: unknown, values: readonly string[]) =>
  sql`${column} in (${sql.raw(values.map((v) => `'${v}'`).join(", "))})`;

export const proposals = pgTable(
  "proposals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // No foreign keys: the sessions and messages tables arrive with the coach.
    sessionId: uuid("session_id"),
    messageId: uuid("message_id"),
    kind: text("kind").notNull(),
    payload: jsonb("payload").notNull(),
    targetId: uuid("target_id"),
    targetVersion: integer("target_version"),
    status: text("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [
    index("proposals_user_status_idx").on(t.userId, t.status),
    check("proposals_kind", inList(t.kind, PROPOSAL_KINDS)),
    check("proposals_status", inList(t.status, PROPOSAL_STATUSES)),
  ],
);
