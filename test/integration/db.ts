import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { inject } from "vitest";
import { createDb, type Db } from "../../packages/core/src/db";

declare module "vitest" {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

export const MIGRATIONS_FOLDER = fileURLToPath(
  new URL("../../packages/core/drizzle", import.meta.url),
);

let shared: Db | undefined;

/** One shared Db per test file (module instances are isolated per file). */
export function getTestDb(): Db {
  shared ??= createDb(inject("databaseUrl")).db;
  return shared;
}

/** Truncates every table in schema `public`. */
export async function resetDb(db: Db): Promise<void> {
  const { rows } = await db.execute<{ tablename: string }>(
    sql`select tablename from pg_tables where schemaname = 'public'`,
  );
  if (rows.length === 0) return;
  const tables = rows.map((r) => `"public"."${r.tablename.replaceAll('"', '""')}"`).join(", ");
  await db.execute(sql.raw(`truncate table ${tables} restart identity cascade`));
}
