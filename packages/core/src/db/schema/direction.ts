import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { Feasibility, RouteStep } from "../../services/paths/schemas";
import type { SkillGap } from "../../taxonomy";
import { user } from "./auth";

/** Columns every direction table shares. `user_id` is on child tables too, so every query can scope by it. */
const common = () => ({
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// clock_timestamp() (not now(), constant within a transaction) so rows inserted together keep their order.
const orderedCreatedAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`);

export const careerPaths = pgTable(
  "career_paths",
  {
    ...common(),
    title: text("title").notNull(),
    occupationCodes: text("occupation_codes").array().notNull().default(sql`'{}'::text[]`),
    rationale: text("rationale").notNull(),
    route: jsonb("route").$type<RouteStep[]>().notNull(),
    skillGaps: jsonb("skill_gaps").$type<SkillGap[]>().notNull(),
    feasibility: jsonb("feasibility").$type<Feasibility>().notNull(),
    status: text("status").notNull().default("explored"),
  },
  (t) => [
    index("career_paths_user_id_idx").on(t.userId),
    check("career_paths_status", sql`${t.status} in ('explored','chosen','dismissed')`),
  ],
);

export const plans = pgTable(
  "plans",
  {
    ...common(),
    northStar: text("north_star").notNull(),
    careerPathId: uuid("career_path_id").references(() => careerPaths.id, {
      onDelete: "set null",
    }),
    status: text("status").notNull().default("active"),
  },
  (t) => [
    uniqueIndex("plans_one_active").on(t.userId).where(sql`status = 'active'`),
    check("plans_status", sql`${t.status} in ('active','archived')`),
  ],
);

export const milestones = pgTable(
  "milestones",
  {
    ...common(),
    createdAt: orderedCreatedAt(),
    planId: uuid("plan_id")
      .notNull()
      .references(() => plans.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    targetDate: date("target_date", { mode: "string" }),
    position: integer("position").notNull(),
    status: text("status").notNull().default("open"),
  },
  (t) => [
    index("milestones_plan_id_idx").on(t.planId),
    check("milestones_status", sql`${t.status} in ('open','done','dropped')`),
  ],
);

export const actions = pgTable(
  "actions",
  {
    ...common(),
    createdAt: orderedCreatedAt(),
    planId: uuid("plan_id")
      .notNull()
      .references(() => plans.id, { onDelete: "cascade" }),
    milestoneId: uuid("milestone_id").references(() => milestones.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    notes: text("notes"),
    weekOf: date("week_of", { mode: "string" }).notNull(),
    status: text("status").notNull().default("todo"),
    doneAt: timestamp("done_at", { withTimezone: true }),
  },
  (t) => [
    index("actions_user_week_idx").on(t.userId, t.weekOf),
    index("actions_plan_id_idx").on(t.planId),
    check("actions_week_of_monday", sql`extract(isodow from ${t.weekOf}) = 1`),
    check("actions_status", sql`${t.status} in ('todo','done','skipped')`),
  ],
);
