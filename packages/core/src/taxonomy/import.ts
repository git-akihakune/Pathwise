import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import type { z } from "zod";
import type { Db, DbOrTx } from "../db";
import { schema } from "../db";
import { ConfigError } from "../errors";
import {
  type Manifest,
  manifestSchema,
  occupationRecordSchema,
  occupationSkillRecordSchema,
  readJsonlGz,
  relationRecordSchema,
  type SnapshotFile,
  skillRecordSchema,
} from "./snapshot";

const IMPORT_LOCK = 0x54415841;
const BATCH = 1000;

async function readManifest(dir: string): Promise<Manifest> {
  const path = join(dir, "manifest.json");
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    throw new ConfigError(
      `Taxonomy snapshot not found at ${path}. Set TAXONOMY_DIR or run pnpm taxonomy:build.`,
    );
  }
  const parsed = manifestSchema.safeParse(JSON.parse(text));
  if (!parsed.success) throw new ConfigError(`Taxonomy manifest at ${path} is invalid.`);
  return parsed.data;
}

async function currentVersion(db: DbOrTx): Promise<string | undefined> {
  const [row] = await db.select({ version: schema.taxonomyMeta.version }).from(schema.taxonomyMeta);
  return row?.version;
}

function hashFile(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash("sha256");
    createReadStream(path)
      .on("data", (c) => h.update(c))
      .on("error", reject)
      .on("end", () => resolve(h.digest("hex")));
  });
}

/** Validates each line of a file and hands it on in batches. */
async function loadFile<S extends z.ZodType>(
  dir: string,
  name: SnapshotFile,
  rowSchema: S,
  insert: (batch: z.output<S>[]) => Promise<unknown>,
): Promise<void> {
  let batch: z.output<S>[] = [];
  let line = 0;
  for await (const raw of readJsonlGz(join(dir, name))) {
    line++;
    const r = rowSchema.safeParse(raw);
    if (!r.success) {
      throw new Error(`${name}:${line}: ${r.error.issues[0]?.message ?? "invalid record"}`);
    }
    batch.push(r.data);
    if (batch.length >= BATCH) {
      await insert(batch);
      batch = [];
    }
  }
  if (batch.length > 0) await insert(batch);
}

export async function importTaxonomySnapshot(
  db: Db,
  dir: string,
): Promise<{ imported: boolean; version: string }> {
  const manifest = await readManifest(dir);
  const { version } = manifest;
  if ((await currentVersion(db)) === version) return { imported: false, version };

  for (const [name, info] of Object.entries(manifest.files)) {
    if ((await hashFile(join(dir, name)).catch(() => null)) !== info.sha256) {
      throw new ConfigError(
        `Taxonomy file ${name} failed its checksum; the snapshot is corrupted or incomplete. Re-download or rebuild it.`,
      );
    }
  }

  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${IMPORT_LOCK})`);
    if ((await currentVersion(tx)) === version) return { imported: false, version };

    // DELETE rather than TRUNCATE so a still-running old process keeps reading the old rows until commit.
    await tx.delete(schema.occupations);
    await tx.delete(schema.taxonomySkills);

    await loadFile(dir, "skills.jsonl.gz", skillRecordSchema, (b) =>
      tx.insert(schema.taxonomySkills).values(b),
    );
    await loadFile(dir, "occupations.jsonl.gz", occupationRecordSchema, (b) =>
      tx.insert(schema.occupations).values(b),
    );
    await loadFile(dir, "occupation_skills.jsonl.gz", occupationSkillRecordSchema, (b) =>
      tx.insert(schema.occupationSkills).values(
        b.map((r) => ({
          occupationId: r.occupationId,
          taxonomySkillId: r.skillId,
          importance: r.importance,
          level: r.level,
        })),
      ),
    );
    await loadFile(dir, "relations.jsonl.gz", relationRecordSchema, (b) =>
      tx.insert(schema.occupationRelations).values(b),
    );

    // System change: deliberately no version bump, so pending proposals don't go stale.
    await tx.execute(sql`
      update skills set taxonomy_skill_id = null
      where taxonomy_skill_id is not null
        and taxonomy_skill_id not in (select id from taxonomy_skills)`);

    await tx
      .insert(schema.taxonomyMeta)
      .values({ id: 1, version, importedAt: sql`now()` })
      .onConflictDoUpdate({
        target: schema.taxonomyMeta.id,
        set: { version, importedAt: sql`now()` },
      });
    return { imported: true, version };
  });
}
