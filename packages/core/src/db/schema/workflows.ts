import { sql } from "drizzle-orm";
import {
  check,
  index,
  jsonb,
  pgTable,
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
