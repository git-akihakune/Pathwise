import { sql } from "drizzle-orm";
import { check, pgTable, smallint, text, timestamp } from "drizzle-orm/pg-core";

export const instanceSettings = pgTable(
  "instance_settings",
  {
    id: smallint("id").primaryKey().default(1),
    signupMode: text("signup_mode").notNull().default("invite_only"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("instance_settings_singleton", sql`${t.id} = 1`),
    check("instance_settings_signup_mode", sql`${t.signupMode} in ('open','invite_only','closed')`),
  ],
);
