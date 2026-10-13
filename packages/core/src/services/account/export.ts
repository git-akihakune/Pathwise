import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { eq, getTableColumns, sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { strToU8, zipSync } from "fflate";
import { type Db, schema } from "../../db";
import { NotFoundError } from "../../errors";

export const EXPORT_TABLES = {
  user_settings: schema.userSettings,
  provider_configs: schema.providerConfigs,
  llm_usage: schema.llmUsage,
  experiences: schema.experiences,
  education: schema.education,
  skills: schema.skills,
  memory_items: schema.memoryItems,
  stories: schema.stories,
  career_paths: schema.careerPaths,
  plans: schema.plans,
  milestones: schema.milestones,
  actions: schema.actions,
  proposals: schema.proposals,
  sessions: schema.sessions,
  messages: schema.messages,
  user_snapshot: schema.userSnapshot,
  workflow_runs: schema.workflowRuns,
  checkins: schema.checkins,
  documents: schema.documents,
} satisfies Record<string, PgTable>;

export const EXPORT_EXCLUDED_TABLES: Record<string, string> = {
  session: "auth tokens",
  account: "password hash and auth tokens",
};

export const EXPORT_OMITTED_COLUMNS: readonly string[] = [
  "encrypted_key",
  "embedding",
  "summary_embedding",
  "search",
  "summary_search",
];

export async function exportUserData(
  db: Db,
  userId: string,
  opts: { filesDir: string; now?: Date },
): Promise<Uint8Array> {
  const tables: Record<string, Record<string, unknown>[]> = {
    user: await db
      .select({
        id: schema.user.id,
        name: schema.user.name,
        email: schema.user.email,
        emailVerified: schema.user.emailVerified,
        role: schema.user.role,
        createdAt: schema.user.createdAt,
      })
      .from(schema.user)
      .where(eq(schema.user.id, userId)),
  };
  for (const [name, table] of Object.entries(EXPORT_TABLES)) {
    const columns = getTableColumns(table);
    const included = Object.fromEntries(
      Object.entries(columns).filter(([, column]) => !EXPORT_OMITTED_COLUMNS.includes(column.name)),
    );
    tables[name] = await db.select(included).from(table).where(eq(columns.userId, userId));
  }
  const { rows } = await db.execute<{ count: number }>(sql`
    select count(*)::int from drizzle.__drizzle_migrations`);
  const migrationCount = rows[0];
  assert(migrationCount, "Migration count query returned no row.");
  const documents = tables.documents;
  assert(documents, "Documents table is missing from the export.");
  const missingFiles: string[] = [];
  const files: Record<string, Uint8Array> = {};
  for (const document of documents) {
    const { filename, storagePath } = document as { filename: string; storagePath: string | null };
    if (storagePath === null) continue;
    // Same ownership and path contract as readDocumentBytes; never read another user's upload.
    const [owner, file, ...rest] = storagePath.split("/");
    if (owner !== userId || !file || rest.length > 0 || !/^[0-9a-f-]{36}$/.test(file)) {
      throw new NotFoundError("Document not found.");
    }
    let bytes: Buffer;
    try {
      bytes = await readFile(join(opts.filesDir, storagePath));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      missingFiles.push(filename);
      continue;
    }
    const sanitized = basename(filename.replace(/\\/g, "/"))
      .replace(/[^\w .()-]/g, "_")
      .trim();
    const name = !sanitized || sanitized === "." || sanitized === ".." ? "file" : sanitized;
    const extension = extname(name);
    const stem = extension ? name.slice(0, -extension.length) : name;
    let unique = name;
    for (let n = 2; Object.hasOwn(files, `files/${unique}`); n++)
      unique = `${stem} (${n})${extension}`;
    files[`files/${unique}`] = bytes;
  }
  const data = {
    meta: {
      app: "pathwise",
      formatVersion: 1,
      schemaVersion: migrationCount.count,
      exportedAt: (opts.now ?? new Date()).toISOString(),
      userId,
      missingFiles,
    },
    tables,
  };
  return zipSync(
    { "pathwise-export.json": strToU8(JSON.stringify(data, null, 2)), ...files },
    { level: 6 },
  );
}
