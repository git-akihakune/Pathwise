import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import type { Capabilities, ProviderModels } from "../../llm/types";
import { user } from "./auth";

export const providerConfigs = pgTable(
  "provider_configs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // null = instance-scope
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    label: text("label").notNull(),
    baseUrl: text("base_url"),
    encryptedKey: text("encrypted_key"),
    keyLast4: text("key_last4"),
    models: jsonb("models").$type<ProviderModels>().notNull(),
    contextWindow: integer("context_window"),
    capabilities: jsonb("capabilities").$type<Capabilities>(),
    status: text("status").notNull().default("untested"),
    authFailed: boolean("auth_failed").notNull().default(false),
    lastTestedAt: timestamp("last_tested_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("provider_configs_user_id_idx").on(t.userId),
    check(
      "provider_configs_kind",
      sql`${t.kind} in ('anthropic','openai','google','openai_compatible')`,
    ),
    check(
      "provider_configs_status",
      sql`${t.status} in ('untested','full','degraded','unsupported')`,
    ),
  ],
);

export const userSettings = pgTable(
  "user_settings",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => user.id, { onDelete: "cascade" }),
    providerConfigId: uuid("provider_config_id").references(() => providerConfigs.id, {
      onDelete: "set null",
    }),
    bluntness: smallint("bluntness").notNull().default(3),
    timezone: text("timezone"),
    checkinEnabled: boolean("checkin_enabled").notNull().default(true),
    checkinDay: smallint("checkin_day").notNull().default(0),
    checkinTime: text("checkin_time").notNull().default("18:00"),
    emailEnabled: boolean("email_enabled").notNull().default(true),
    checkinIcsSequence: integer("checkin_ics_sequence").notNull().default(0),
    profileVersion: integer("profile_version").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("user_settings_bluntness", sql`${t.bluntness} between 1 and 5`),
    check("user_settings_checkin_day", sql`${t.checkinDay} between 0 and 6`),
  ],
);

export const llmUsage = pgTable(
  "llm_usage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    providerConfigId: uuid("provider_config_id").references(() => providerConfigs.id, {
      onDelete: "set null",
    }),
    model: text("model").notNull(),
    role: text("role").notNull(),
    purpose: text("purpose").notNull(),
    inputTokens: integer("input_tokens").notNull(),
    outputTokens: integer("output_tokens").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("llm_usage_user_created_idx").on(t.userId, t.createdAt),
    index("llm_usage_created_idx").on(t.createdAt),
    check("llm_usage_role", sql`${t.role} in ('main','fast','embedding')`),
  ],
);
