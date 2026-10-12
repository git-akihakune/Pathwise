import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { createGunzip, gzipSync } from "node:zlib";
import { z } from "zod";

export const SNAPSHOT_FILES = [
  "occupations.jsonl.gz",
  "skills.jsonl.gz",
  "occupation_skills.jsonl.gz",
  "relations.jsonl.gz",
] as const;
export type SnapshotFile = (typeof SNAPSHOT_FILES)[number];

export const MAX_SNAPSHOT_BYTES = 20 * 1024 * 1024;

export interface OccupationRecord {
  id: string;
  source: "onet" | "esco";
  code: string;
  title: string;
  description: string;
  altTitles: string[];
  tasks: string[];
}
export interface SkillRecord {
  id: string;
  source: "onet" | "esco";
  code: string;
  name: string;
  description: string;
}
export interface OccupationSkillRecord {
  occupationId: string;
  skillId: string;
  importance: number;
  level: number | null;
}
export interface RelationRecord {
  fromId: string;
  toId: string;
  kind: "related" | "crosswalk";
}
export interface SnapshotData {
  occupations: OccupationRecord[];
  skills: SkillRecord[];
  occupationSkills: OccupationSkillRecord[];
  relations: RelationRecord[];
}
export interface SnapshotSources {
  onet: { version: string; url: string; sha256: string } | null;
  esco: { version: string } | null;
  crosswalk: { file: string; sha256: string } | null;
}
export interface Manifest {
  format: 1;
  version: string;
  builtAt: string;
  sources: SnapshotSources;
  files: Record<SnapshotFile, { sha256: string; bytes: number; rows: number }>;
}

const source = z.enum(["onet", "esco"]);
const idFor = (src: "onet" | "esco", id: string) => id.startsWith(`${src}:`);

export const occupationRecordSchema = z
  .object({
    id: z.string().min(1),
    source,
    code: z.string().min(1),
    title: z.string().min(1),
    description: z.string(),
    altTitles: z.array(z.string()),
    tasks: z.array(z.string()),
  })
  .refine((r) => idFor(r.source, r.id), { message: "id must start with `<source>:`" });

export const skillRecordSchema = z
  .object({
    id: z.string().min(1),
    source,
    code: z.string().min(1),
    name: z.string().min(1),
    description: z.string(),
  })
  .refine((r) => idFor(r.source, r.id), { message: "id must start with `<source>:`" });

export const occupationSkillRecordSchema = z.object({
  occupationId: z.string().min(1),
  skillId: z.string().min(1),
  importance: z.number().min(0).max(1),
  level: z.number().nullable(),
});

export const relationRecordSchema = z.object({
  fromId: z.string().min(1),
  toId: z.string().min(1),
  kind: z.enum(["related", "crosswalk"]),
});

const fileInfo = z.object({
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  bytes: z.number().int().nonnegative(),
  rows: z.number().int().nonnegative(),
});

export const manifestSchema: z.ZodType<Manifest> = z.object({
  format: z.literal(1),
  version: z.string().min(1),
  builtAt: z.string(),
  sources: z.object({
    onet: z.object({ version: z.string(), url: z.string(), sha256: z.string() }).nullable(),
    esco: z.object({ version: z.string() }).nullable(),
    crosswalk: z.object({ file: z.string(), sha256: z.string() }).nullable(),
  }),
  files: z.object({
    "occupations.jsonl.gz": fileInfo,
    "skills.jsonl.gz": fileInfo,
    "occupation_skills.jsonl.gz": fileInfo,
    "relations.jsonl.gz": fileInfo,
  }),
});

const sha256 = (buf: Buffer) => createHash("sha256").update(buf).digest("hex");

export async function writeSnapshot(
  dir: string,
  data: SnapshotData,
  sources: SnapshotSources,
  opts: { maxBytes?: number } = {},
): Promise<Manifest> {
  const rowsByFile: Record<SnapshotFile, unknown[]> = {
    "occupations.jsonl.gz": data.occupations,
    "skills.jsonl.gz": data.skills,
    "occupation_skills.jsonl.gz": data.occupationSkills,
    "relations.jsonl.gz": data.relations,
  };
  const buffers = {} as Record<SnapshotFile, Buffer>;
  const files = {} as Manifest["files"];
  let total = 0;
  for (const name of SNAPSHOT_FILES) {
    const rows = rowsByFile[name];
    const text = rows.map((r) => `${JSON.stringify(r)}\n`).join("");
    const gz = gzipSync(Buffer.from(text), { level: 9 });
    buffers[name] = gz;
    files[name] = { sha256: sha256(gz), bytes: gz.length, rows: rows.length };
    total += gz.length;
  }
  const maxBytes = opts.maxBytes ?? MAX_SNAPSHOT_BYTES;
  if (total > maxBytes) {
    const mb = (n: number) => (n / (1024 * 1024)).toFixed(1);
    throw new Error(
      `Snapshot is ${mb(total)} MB gzipped; the limit is ${mb(maxBytes)} MB (spec §14).`,
    );
  }
  const label =
    [sources.onet && `onet-${sources.onet.version}`, sources.esco && `esco-${sources.esco.version}`]
      .filter(Boolean)
      .join("+") || "custom";
  const hash = createHash("sha256")
    .update(SNAPSHOT_FILES.map((n) => files[n].sha256).join(""))
    .digest("hex")
    .slice(0, 8);
  const manifest: Manifest = {
    format: 1,
    version: `${label}-${hash}`,
    builtAt: new Date().toISOString(),
    sources,
    files,
  };
  await mkdir(dir, { recursive: true });
  for (const name of SNAPSHOT_FILES) await writeFile(join(dir, name), buffers[name]);
  await writeFile(join(dir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

export async function* readJsonlGz(path: string): AsyncIterable<unknown> {
  const input = createReadStream(path).pipe(createGunzip());
  const lines = createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) {
    if (line.trim() !== "") yield JSON.parse(line);
  }
}
