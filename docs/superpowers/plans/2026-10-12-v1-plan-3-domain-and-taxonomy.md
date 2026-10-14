# Pathwise v1 · Plan 3: Domain & Taxonomy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The three shared things every later feature reads and writes (Profile, Story Bank, Plan) exist as user-scoped core services with optimistic versioning, plus the Proposals engine that is the agent's only write path, plus Profile / Stories / Plan screens for manual editing. A bundled, version-pinned O\*NET + ESCO snapshot is imported by `init` with no network access.

**Architecture:** New Drizzle tables in `profile.ts`, `direction.ts`, `proposals.ts`, `taxonomy.ts` (+ shared `columns.ts`). Domain services in `packages/core/src/services/{profile,memory,stories,paths,plan,proposals}` take `(db, userId, …)` and scope every statement by `user_id`. `approveProposal` applies a proposal by calling those same services inside one transaction. `packages/core/src/taxonomy` owns the snapshot format, the streaming import, and the read queries. A maintainer-only script (`scripts/taxonomy/build.ts`) reduces the O\*NET and ESCO downloads to a gzipped JSONL snapshot committed under `data/taxonomy/`. No LLM calls anywhere in this plan.

**Tech Stack:** Plan 1's stack, plus `date-fns` 4.x and `@date-fns/tz` 1.x (core and web), `fflate` 0.8.x and `csv-parse` 7.x (root devDependencies, build script only), pgvector (already in the `pgvector/pgvector:pg17` image).

**Spec:** [docs/superpowers/specs/2026-10-12-pathwise-design.md](../specs/2026-10-12-pathwise-design.md). This plan implements §3.1, §3.5 (Profile, Stories, Plan screens), §5.4, §6.2 (except `documents` and `user_snapshot`), §6.3, §6.4 (`proposals` only), §6.5, and the taxonomy step of `init` in §4.5.

**Cross-plan contract:** [2026-10-12-v1-plans-2-6-contract.md](2026-10-12-v1-plans-2-6-contract.md) fixes the names shared between Plans 2–6. This plan's *Interfaces* blocks refine it and take precedence.

> Drafted before Plan 2 was implemented. Before starting, check every *Consumes* signature against the merged code and fix the plan where they differ.

## Spec gaps resolved

1. **Dates on experiences and education** are text holding a partial ISO date (`YYYY`, `YYYY-MM`, or `YYYY-MM-DD`), because CVs rarely give days. They sort correctly as strings. `end_date = null` means "present".
2. **Taxonomy ids are stable text**, `onet:<O*NET-SOC code or Element ID>` and `esco:<concept UUID>`, so a re-import keeps the same ids. `skills.taxonomy_skill_id` has **no foreign key** (a replace-all import would otherwise cascade or block). After each import, links to ids that no longer exist are set to null (Task 4).
3. **O\*NET 31.0 layout.** O\*NET 31.0 (August 2026) has no `Skills.txt` or `Alternate Titles.txt`. Skills come from `Essential Skills.txt` + `Transferable Skills.txt` + `Knowledge.txt`. Alternate titles come from `Sample of Reported Titles.txt` then `Job Titles.txt` (deduplicated, at most 30).
4. **ESCO is downloaded by hand** (the portal emails a link). If the person running Task 2 has no ESCO export, they commit an O\*NET-only snapshot and say so in the PR. Adding ESCO later changes the snapshot version, so `init` re-imports on the next boot.
5. **`plan_create` staleness.** Its target is the active plan at proposal time (or none). If a different plan is active at approval time, the proposal is `conflicted`, so approving it can't silently archive a plan the user made by hand in the meantime.
6. **`action_status_update` is all-or-nothing.** If any item's `basedOnVersion` is stale, nothing is applied and the proposal is `conflicted`.
7. **Provenance of approved proposals:** `source_type = 'message'`, `source_id = proposals.message_id`.
8. **"Important" occupation skills** are those with `importance ≥ 0.5`. Skill gaps exclude a skill when its id matches one of the user's linked taxonomy skills, or when its name matches one of the user's skill names case-insensitively. Without the name rule, O\*NET's two "Mathematics" descriptors (a skill and a knowledge area) would show up as a false gap.
9. **`setMemoryStatus` only changes `pending` items.** Removing an active item is `deleteMemory`.
10. **E2E coverage for path comparison and pending memories is deferred to Plan 4.** Before the coach exists, only the coach (or tests) creates paths and pending memories. This plan covers both with integration tests and a unit test for the comparison table.

## Global Constraints

- All user data is read and written through `packages/core` services taking `(db, userId, …)`. Every statement on a user-owned table filters by `user_id`, including updates and deletes by id. Another user's id behaves exactly like a missing id (`NotFoundError`), so ids can't be probed.
- `packages/core` never imports `next` or `next/*`.
- The agent never writes user data. Proposals apply through the same domain services the UI calls.
- Versions: `date-fns` `4.x`, `@date-fns/tz` `1.x`, `fflate` `0.8.x`, `csv-parse` `7.x`.
- Every update bumps `version` by 1 and sets `updated_at = now()`. If `expectedVersion` is given and differs, the service throws `ConflictError` and nothing changes.
- Any change to experiences, education, skills, or the **active** memory set bumps `user_settings.profile_version` in the same transaction (upserting the row).
- A change to `memory_items.content` or to any story text field sets `embedding` and `embedding_model` to null.
- Length limits: titles and names 1–200 characters; long text ≤ 4000; memory content 1–1000; list fields ≤ 20 items.
- `week_of` is the Monday (ISO week) of the local date in the user's `effectiveTimezone`. It is stored as `date`, and both the services and a DB check reject non-Mondays.
- Taxonomy snapshot: at most **20 MB gzipped** across its four data files. The build fails above that (spec §14).
- No network at boot. `init` imports only from `TAXONOMY_DIR` (default `/app/data/taxonomy`; `dev.env` sets `./data/taxonomy`). A missing manifest fails `init` with `ConfigError`.
- Pinned sources: O\*NET **31.0** text database (`https://www.onetcenter.org/dl_files/database/db_31_0_text.zip`, sha256 `6883548adf5fde64cf6f801b35d15519c9225f2732c3cab0e281c652d16b23a9`); ESCO **v1.2.1**, English, CSV, classification package.
- Importance normalization: O\*NET IM (1–5) → `(v − 1) / 4`; ESCO essential → `1.0`, optional → `0.5`. Round to 2 decimals. Importance, level, and confidence are `double precision` (not `real`, which would read back 0.94 as 0.9399999…).

## Review Focus

These are the five failure modes most likely to bite a real user. Each has a test in the task that owns the code:

1. **A proposal made before a manual edit is approved afterwards** (the coach proposes a new job title, the user edits the organization by hand, then clicks Approve) → the proposal becomes `conflicted` and the manual edit survives. It is never silently overwritten. (Task 8)
2. **Weekly actions land in the wrong week** for users far from UTC or across DST changes (Sunday night in Los Angeles is Monday in UTC; Monday morning in Auckland is Sunday in UTC) → `week_of` is always the Monday of the user's local week. (Task 7)
3. **A Pathwise upgrade ships a new taxonomy snapshot** → the import replaces the old data atomically (a failed import leaves the old taxonomy and version intact), and users' skills keep their taxonomy links unless the linked skill was removed. (Tasks 1 and 4)
4. **Two plans are created at the same moment** (a double-submitted form, or a `plan_create` approval racing a manual create) → exactly one active plan remains and the other is archived, never a 500 or two active plans. (Task 7)
5. **The same proposal is approved twice** (double-click, two tabs) → it is applied exactly once. The second call fails with `ConflictError` and creates nothing. (Task 8)

---

## File structure

```
data/taxonomy/{manifest.json,occupations.jsonl.gz,skills.jsonl.gz,occupation_skills.jsonl.gz,relations.jsonl.gz,README.md}
scripts/taxonomy/{build.ts,onet.ts,esco.ts,crosswalk.ts,tsconfig.json}  (+ onet.test.ts, esco.test.ts)
test/fixtures/taxonomy/{records.ts,generate.ts,manifest.json,*.jsonl.gz}
e2e/{profile.spec.ts,stories.spec.ts,plan.spec.ts}
packages/core/
  drizzle/*                                 (custom pgvector migration + generated ones)
  src/errors/index.ts                       (+ ConflictError)
  src/db/client.ts                          (+ Tx, DbOrTx)
  src/db/schema/{columns.ts,taxonomy.ts,profile.ts,direction.ts,proposals.ts}
  src/taxonomy/{snapshot.ts,import.ts,queries.ts,index.ts}
  src/services/profile/{service.ts,version.ts,index.ts}
  src/services/memory/{service.ts,index.ts}
  src/services/stories/{service.ts,index.ts}
  src/services/paths/{schemas.ts,service.ts,index.ts}
  src/services/plan/{week.ts,service.ts,index.ts}
  src/services/proposals/{schemas.ts,service.ts,index.ts}
apps/worker/src/init.ts                     (taxonomy import step)
apps/web/src/
  lib/form-error.ts
  components/{source-label.tsx,confirm-delete.tsx,pending-memory-list.tsx}
  components/ui/{textarea.tsx,checkbox.tsx}  (shadcn)
  app/(app)/profile/{page.tsx,actions.ts,experience-section.tsx,education-section.tsx,skills-section.tsx,skill-picker.tsx,memory-section.tsx}
  app/(app)/stories/{page.tsx,actions.ts,story-form.tsx,new/page.tsx,[id]/edit/page.tsx}
  app/(app)/plan/{page.tsx,actions.ts,compare.ts,path-comparison.tsx,milestones-section.tsx,actions-section.tsx}
```

**Service file shape:** each `services/<name>/service.ts` exports its Zod input schemas, types, and functions, and `index.ts` re-exports them. Services accept `db: DbOrTx` (a widening of the contract's `Db`, so the proposals engine can pass its transaction). A service that writes more than one statement wraps them in `db.transaction(…)`; called with a transaction, this becomes a savepoint.

---

### Task 1: Taxonomy schema, snapshot format, import, and queries

**Files:**
- Create: `packages/core/src/db/schema/{columns.ts,taxonomy.ts}`, `packages/core/src/taxonomy/{snapshot.ts,import.ts,queries.ts,index.ts}`, `test/fixtures/taxonomy/{records.ts,generate.ts}` + generated `manifest.json` and four `.jsonl.gz` files
- Modify: `packages/core/src/db/schema/index.ts`, `packages/core/drizzle/*` (a custom migration and a generated one), `test/integration/db.ts` (export `TAXONOMY_FIXTURE_DIR`), root `package.json` (`taxonomy:fixture`), `biome.json` (ignore `data/taxonomy` and `test/fixtures/taxonomy/manifest.json`), `.gitattributes` (`*.gz binary`)
- Test: `packages/core/src/taxonomy/snapshot.test.ts`, `packages/core/src/taxonomy/taxonomy.int.test.ts`

**Interfaces:**
- Consumes: `Db`, `ConfigError` (Plan 1).
- Produces:
  ```ts
  // db/schema/columns.ts
  export const anyVector: /* customType<{ data: number[]; driverData: string }> */; // dataType "vector"; toDriver `[${v.join(",")}]`; fromDriver JSON.parse
  export const tsvector: /* customType<{ data: string }> */;                         // dataType "tsvector"
  // @pathwise/core/taxonomy (snapshot.ts)
  export const SNAPSHOT_FILES = ["occupations.jsonl.gz", "skills.jsonl.gz", "occupation_skills.jsonl.gz", "relations.jsonl.gz"] as const;
  export type SnapshotFile = (typeof SNAPSHOT_FILES)[number];
  export interface OccupationRecord { id: string; source: "onet" | "esco"; code: string; title: string; description: string; altTitles: string[]; tasks: string[] }
  export interface SkillRecord { id: string; source: "onet" | "esco"; code: string; name: string; description: string }
  export interface OccupationSkillRecord { occupationId: string; skillId: string; importance: number; level: number | null }
  export interface RelationRecord { fromId: string; toId: string; kind: "related" | "crosswalk" }
  export interface SnapshotData { occupations: OccupationRecord[]; skills: SkillRecord[]; occupationSkills: OccupationSkillRecord[]; relations: RelationRecord[] }
  export interface SnapshotSources { onet: { version: string; url: string; sha256: string } | null; esco: { version: string } | null; crosswalk: { file: string; sha256: string } | null }
  export interface Manifest { format: 1; version: string; builtAt: string; sources: SnapshotSources; files: Record<SnapshotFile, { sha256: string; bytes: number; rows: number }> }
  export const MAX_SNAPSHOT_BYTES = 20 * 1024 * 1024;
  export const manifestSchema: z.ZodType<Manifest>;   // plus one Zod schema per record type; an id must start with `${source}:`
  export function writeSnapshot(dir: string, data: SnapshotData, sources: SnapshotSources, opts?: { maxBytes?: number }): Promise<Manifest>;
  export function readJsonlGz(path: string): AsyncIterable<unknown>;
  // @pathwise/core/taxonomy (import.ts, queries.ts)
  export function importTaxonomySnapshot(db: Db, dir: string): Promise<{ imported: boolean; version: string }>;
  export interface OccupationSummary { id: string; source: "onet" | "esco"; code: string; title: string; description: string }
  export interface OccupationDetail extends OccupationSummary { altTitles: string[]; tasks: string[]; skills: { id: string; name: string; importance: number }[]; related: OccupationSummary[] }
  export function searchOccupations(db: Db, query: string, opts?: { limit?: number; source?: "onet" | "esco" }): Promise<OccupationSummary[]>;
  export function getOccupation(db: Db, idOrCode: string): Promise<OccupationDetail | null>;
  export function searchTaxonomySkills(db: Db, query: string, limit?: number): Promise<{ id: string; name: string; source: "onet" | "esco" }[]>;
  export function matchTaxonomySkill(db: Db, name: string): Promise<string | null>;
  ```
- Test helper: `test/integration/db.ts` exports `TAXONOMY_FIXTURE_DIR` (absolute path to `test/fixtures/taxonomy`).

- [ ] **Step 1: Custom migration, columns, schema, fixture**

  1. Run `pnpm --filter @pathwise/core exec drizzle-kit generate --custom --name=pgvector` and fill the new SQL file with:
     ```sql
     CREATE EXTENSION IF NOT EXISTS vector;
     --> statement-breakpoint
     CREATE OR REPLACE FUNCTION immutable_array_to_string(arr text[], sep text) RETURNS text
       LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$ SELECT array_to_string(arr, sep) $$;
     ```
     Generated columns require immutable expressions. `array_to_string` and `concat_ws` are only `STABLE`, so tsvector expressions use this wrapper and `coalesce(…, '') || ' ' || …`.
  2. `columns.ts` as in Interfaces. Pass vectors as text literals so no pgvector client library is needed.
  3. `taxonomy.ts`. Generated expressions reference raw quoted column names (Drizzle's `generatedAlwaysAs` can't reference sibling columns):
     - `occupations`: `id text pk`, `source text not null` (check `in ('onet','esco')`), `code text not null`, `title text not null`, `description text not null default ''`, `alt_titles text[] not null default '{}'`, `tasks text[] not null default '{}'`, `embedding anyVector`, `embedding_model text`, `search tsvector generated always as (setweight(to_tsvector('english', "title"), 'A') || setweight(to_tsvector('english', immutable_array_to_string("alt_titles", ' ')), 'B') || setweight(to_tsvector('english', "description"), 'C')) stored`; unique `(source, code)`; GIN index on `search`.
     - `taxonomy_skills`: `id text pk`, `source`, `code`, `name text not null`, `description text not null default ''`, `search` = name weight A + description weight B; unique `(source, code)`; GIN on `search`; btree index on `lower(name)`.
     - `occupation_skills`: `occupation_id text → occupations(id) on delete cascade`, `taxonomy_skill_id text → taxonomy_skills(id) on delete cascade`, `importance double precision not null` (check 0–1), `level double precision`; pk `(occupation_id, taxonomy_skill_id)`; index on `taxonomy_skill_id`.
     - `occupation_relations`: `from_id`, `to_id` (both → occupations cascade), `kind text` (check `in ('related','crosswalk')`); pk `(from_id, to_id, kind)`.
     - `taxonomy_meta`: `id smallint pk default 1` (check `id = 1`), `version text not null`, `imported_at timestamptz not null default now()`.
  4. `test/fixtures/taxonomy/records.ts` exports `FIXTURE: SnapshotData` with exactly these rows (tests count them):
     - **skills (8):** `onet:2.B.3.e` Programming, `onet:2.A.2.a` Critical Thinking, `onet:2.B.1.f` Service Orientation, `onet:2.C.3.a` Computers and Electronics, `onet:2.C.5.a` Medicine and Dentistry, `onet:2.A.1.e` Mathematics, `onet:2.C.4.a` Mathematics, `esco:skill-python` "Python (computer programming)". `code` is the part after the colon. Descriptions are one short sentence each.
     - **occupations (5):** `onet:15-1252.00` "Software Developers" (alt `["Software Engineer","Application Developer"]`, desc "Research, design, and develop computer and network software or specialized utility programs.", tasks `["Modify existing software to correct errors.","Analyze user needs and software requirements."]`); `onet:15-1253.00` "Software Quality Assurance Analysts and Testers" (alt `["QA Tester"]`, desc "Develop and execute software tests to identify software problems and their causes."); `onet:29-1141.00` "Registered Nurses" (alt `["RN","Staff Nurse"]`, desc "Assess patient health problems and needs, develop and implement nursing care plans, and maintain medical records."); `onet:11-9111.00` "Medical and Health Services Managers" (alt `["Clinic Manager"]`, desc "Plan, direct, or coordinate medical and health services in hospitals, clinics, or similar organizations."); `esco:occ-software-developer`, code `2512.4`, "software developer" (alt `["programmer","software engineer"]`, desc "Software developers implement or program all kinds of software systems.", tasks `[]`). O\*NET occupations without listed tasks get `[]`.
     - **occupation skills (13):** 15-1252.00 → Programming 0.94, Computers and Electronics 0.88, Critical Thinking 0.72, Mathematics (`2.C.4.a`) 0.55, Service Orientation 0.31; 15-1253.00 → Programming 0.62, Critical Thinking 0.70; 29-1141.00 → Service Orientation 0.85, Critical Thinking 0.80, Medicine and Dentistry 0.78; 11-9111.00 → Critical Thinking 0.75, Service Orientation 0.60; esco occupation → Python 1.0. All `level: null`.
     - **relations (4):** 15-1252.00 → 15-1253.00 `related`; 29-1141.00 → 11-9111.00 `related`; esco occupation ↔ 15-1252.00 `crosswalk` (both directions).
  5. `generate.ts` calls `writeSnapshot(<its dir>, FIXTURE, { onet: null, esco: null, crosswalk: null })`. Root script `taxonomy:fixture` = `tsx test/fixtures/taxonomy/generate.ts`.

  Run: `pnpm --filter @pathwise/core db:generate`
  Expected: a migration creating the five tables with generated `search` columns and GIN indexes, applied after the `pgvector` one.

- [ ] **Step 2: Write the failing tests**

  ```ts
  // packages/core/src/taxonomy/snapshot.test.ts
  import { existsSync, mkdtempSync } from "node:fs";
  import { tmpdir } from "node:os";
  import { join } from "node:path";
  import { expect, it } from "vitest";
  import { FIXTURE } from "../../../../test/fixtures/taxonomy/records";
  import { readJsonlGz, writeSnapshot } from "./snapshot";

  const tmp = () => mkdtempSync(join(tmpdir(), "snap-"));
  const ONET = { onet: { version: "31.0", url: "u", sha256: "s" }, esco: null, crosswalk: null };

  it("writes gzipped JSONL with checksums and a deterministic, content-derived version", async () => {
    const dir = tmp();
    const m = await writeSnapshot(dir, FIXTURE, ONET);
    expect(m.version).toMatch(/^onet-31\.0-[0-9a-f]{8}$/);
    expect(m.files["occupation_skills.jsonl.gz"].rows).toBe(13);
    const rows: unknown[] = [];
    for await (const r of readJsonlGz(join(dir, "occupations.jsonl.gz"))) rows.push(r);
    expect(rows).toEqual(FIXTURE.occupations);
    expect((await writeSnapshot(tmp(), FIXTURE, ONET)).version).toBe(m.version);
  });
  it("refuses to write anything over the size limit", async () => {
    const dir = tmp();
    await expect(writeSnapshot(dir, FIXTURE, ONET, { maxBytes: 100 })).rejects.toThrow(/the limit is/);
    expect(existsSync(join(dir, "manifest.json"))).toBe(false);
  });
  ```

  ```ts
  // packages/core/src/taxonomy/taxonomy.int.test.ts
  import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
  import { tmpdir } from "node:os";
  import { join } from "node:path";
  import { sql } from "drizzle-orm";
  import { beforeEach, describe, expect, it } from "vitest";
  import { FIXTURE } from "../../../../test/fixtures/taxonomy/records";
  import { getTestDb, resetDb, TAXONOMY_FIXTURE_DIR } from "../../../../test/integration/db";
  import { ConfigError } from "../errors";
  import {
    getOccupation, importTaxonomySnapshot, matchTaxonomySkill, searchOccupations,
    searchTaxonomySkills, writeSnapshot,
  } from ".";

  const db = getTestDb();
  const NONE = { onet: null, esco: null, crosswalk: null };
  const tmp = () => mkdtempSync(join(tmpdir(), "tax-"));
  const versionOf = (dir: string) => JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")).version;
  const count = async (t: string) =>
    (await db.execute<{ n: number }>(sql.raw(`select count(*)::int as n from ${t}`))).rows[0]?.n;

  beforeEach(() => resetDb(db));

  describe("importTaxonomySnapshot", () => {
    it("imports once and records the version", async () => {
      const version = versionOf(TAXONOMY_FIXTURE_DIR);
      expect(await importTaxonomySnapshot(db, TAXONOMY_FIXTURE_DIR)).toEqual({ imported: true, version });
      expect([await count("occupations"), await count("taxonomy_skills"),
        await count("occupation_skills"), await count("occupation_relations")]).toEqual([5, 8, 13, 4]);
      expect(await importTaxonomySnapshot(db, TAXONOMY_FIXTURE_DIR)).toEqual({ imported: false, version });
    });
    it("fails loudly without a manifest", async () => {
      await expect(importTaxonomySnapshot(db, tmp())).rejects.toBeInstanceOf(ConfigError);
    });
    it("rejects a corrupted file before touching the database", async () => {
      const dir = tmp();
      await writeSnapshot(dir, FIXTURE, NONE);
      writeFileSync(join(dir, "relations.jsonl.gz"), "garbage");
      await expect(importTaxonomySnapshot(db, dir)).rejects.toThrow(/checksum/);
      expect(await count("occupations")).toBe(0);
    });
    it("replaces atomically and keeps the old data when the new import fails (Review Focus 3)", async () => {
      await importTaxonomySnapshot(db, TAXONOMY_FIXTURE_DIR);
      const broken = tmp();
      await writeSnapshot(broken, { ...FIXTURE, occupationSkills: [...FIXTURE.occupationSkills,
        { occupationId: "onet:15-1252.00", skillId: "onet:9.Z.9", importance: 0.9, level: null }] }, NONE);
      await expect(importTaxonomySnapshot(db, broken)).rejects.toThrow();
      expect(await count("occupation_skills")).toBe(13);
      expect((await db.execute(sql`select version from taxonomy_meta`)).rows)
        .toEqual([{ version: versionOf(TAXONOMY_FIXTURE_DIR) }]);
      const v2 = tmp();
      await writeSnapshot(v2, { ...FIXTURE, occupations: FIXTURE.occupations.map((o) =>
        o.id === "onet:29-1141.00" ? { ...o, title: "Registered Nurses (RN)" } : o) }, NONE);
      expect((await importTaxonomySnapshot(db, v2)).imported).toBe(true);
      expect((await getOccupation(db, "29-1141.00"))?.title).toBe("Registered Nurses (RN)");
      expect(await count("occupations")).toBe(5);
    });
  });

  describe("queries", () => {
    beforeEach(() => importTaxonomySnapshot(db, TAXONOMY_FIXTURE_DIR));
    it("matches alternate titles and filters by source", async () => {
      expect((await searchOccupations(db, "software engineer")).map((o) => o.id).sort())
        .toEqual(["esco:occ-software-developer", "onet:15-1252.00"]);
      expect((await searchOccupations(db, "software engineer", { source: "onet" })).map((o) => o.id))
        .toEqual(["onet:15-1252.00"]);
    });
    it("ranks title matches above description matches", async () => {
      expect((await searchOccupations(db, "medical")).map((o) => o.id))
        .toEqual(["onet:11-9111.00", "onet:29-1141.00"]);
    });
    it("returns nothing for blank input and tolerates operator characters", async () => {
      expect(await searchOccupations(db, "   ")).toEqual([]);
      await expect(searchOccupations(db, 'nurse & | ! "')).resolves.toBeInstanceOf(Array);
    });
    it("gets an occupation by id or code", async () => {
      const occ = await getOccupation(db, "15-1252.00");
      expect(await getOccupation(db, "onet:15-1252.00")).toEqual(occ);
      expect(occ?.altTitles).toEqual(["Software Engineer", "Application Developer"]);
      expect(occ?.tasks).toHaveLength(2);
      expect(occ?.skills.map((s) => [s.name, s.importance])).toEqual([["Programming", 0.94],
        ["Computers and Electronics", 0.88], ["Critical Thinking", 0.72], ["Mathematics", 0.55],
        ["Service Orientation", 0.31]]);
      expect(occ?.related.map((r) => r.id).sort()).toEqual(["esco:occ-software-developer", "onet:15-1253.00"]);
      expect(await getOccupation(db, "99-9999.00")).toBeNull();
    });
    it("searches skills by substring, exact and prefix matches first", async () => {
      expect((await searchTaxonomySkills(db, "Programm")).map((s) => s.name))
        .toEqual(["Programming", "Python (computer programming)"]);
    });
    it("matches a skill name exactly, ignoring case and spaces, preferring O*NET then id", async () => {
      expect(await matchTaxonomySkill(db, "  programming ")).toBe("onet:2.B.3.e");
      expect(await matchTaxonomySkill(db, "Mathematics")).toBe("onet:2.A.1.e");
      expect(await matchTaxonomySkill(db, "python")).toBeNull();
    });
  });
  ```

- [ ] **Step 3: Run tests to verify they fail**

  Run: `pnpm test packages/core/src/taxonomy && pnpm test:int packages/core/src/taxonomy`
  Expected: FAIL. `./snapshot` and `.` don't resolve (the fixture files don't exist yet either).

- [ ] **Step 4: Implement**

  - **`writeSnapshot`:** serialize each array as one JSON object per line and gzip with `gzipSync(buf, { level: 9 })`. Node writes `MTIME = 0`, so output is reproducible. Sum the bytes; above `maxBytes ?? MAX_SNAPSHOT_BYTES`, throw `Error("Snapshot is <x.y> MB gzipped; the limit is <n> MB (spec §14).")` before writing anything. Otherwise write the four files and `manifest.json` (`JSON.stringify(m, null, 2) + "\n"`).
    - `version` = `<label>-<first 8 hex of sha256(file sha256s joined in SNAPSHOT_FILES order)>`.
    - `<label>` = the present parts of `onet-<v>` and `esco-<v>` joined with `+`, or `custom` when both are absent.
    - `builtAt` = `new Date().toISOString()`.
  - **`readJsonlGz`:** `createReadStream → createGunzip() → readline`. Yield `JSON.parse` of each non-empty line.
  - **`importTaxonomySnapshot`:**
    1. Read and parse `manifest.json`. If it is missing, throw `ConfigError("Taxonomy snapshot not found at <dir>/manifest.json. Set TAXONOMY_DIR or run pnpm taxonomy:build.")`.
    2. If `taxonomy_meta.version === manifest.version`, return `{ imported: false, version }`.
    3. Stream-hash every file. On a mismatch, throw `ConfigError("Taxonomy file <name> failed its checksum …")`.
    4. Start one transaction and take `pg_advisory_xact_lock(0x54415841)`. Re-check the version (a concurrent init may have finished). `delete from occupations; delete from taxonomy_skills` (cascades). `DELETE`, not `TRUNCATE`, so a still-running old `web` keeps reading the old rows until commit.
    5. Insert skills, occupations, occupation skills, then relations, in batches of 1000. Validate each line with its record schema; an error names `<file>:<line>`.
    6. Upsert `taxonomy_meta` `(1, version, now())`.
  - **`searchOccupations`:** trim the query; empty → `[]`. `where search @@ websearch_to_tsquery('english', q)` (+ source filter), `order by ts_rank(search, query) desc, title asc`, `limit` = clamp(`limit ?? 10`, 1, 50).
  - **`getOccupation`:** match `id = x or code = x`, preferring `source = 'onet'`. Skills ordered by importance desc, then name. `related` covers both relation kinds from this occupation, ordered by title.
  - **`searchTaxonomySkills`:** trimmed query of fewer than 2 characters → `[]`. Match `search @@ websearch_to_tsquery(q)` or `name ilike '%' || escaped(q) || '%'` (escape `%`, `_`, `\`). Order by: exact `lower(name) = lower(q)` first, then prefix `ilike q%`, then `ts_rank` desc, then name. Limit `limit ?? 10`.
  - **`matchTaxonomySkill`:** `where lower(name) = lower(trim($1)) order by (source = 'onet') desc, id asc limit 1`.

  Run `pnpm taxonomy:fixture` and commit the generated files.

- [ ] **Step 5: Run tests**

  Run: `pnpm test packages/core/src/taxonomy && pnpm test:int packages/core/src/taxonomy && pnpm lint && pnpm typecheck`
  Expected: PASS.

- [ ] **Step 6: Commit**

  ```bash
  git add -A
  git commit -m "feat: add taxonomy schema, snapshot format, import, and queries"
  ```

---

### Task 2: Taxonomy build script and bundled snapshot

**Files:**
- Create: `scripts/taxonomy/{build.ts,onet.ts,esco.ts,crosswalk.ts,tsconfig.json}`, `data/taxonomy/README.md`, and (maintainer step) `data/taxonomy/{manifest.json,*.jsonl.gz}`
- Modify: root `package.json` (`taxonomy:build` = `tsx scripts/taxonomy/build.ts`; `typecheck` = `pnpm -r typecheck && tsc -p scripts/taxonomy`; devDependencies `fflate`, `csv-parse`), `vitest.config.ts` (unit project also includes `scripts/**/*.test.ts`)
- Test: `scripts/taxonomy/onet.test.ts`, `scripts/taxonomy/esco.test.ts`

**Interfaces:**
- Consumes: `writeSnapshot`, record types (Task 1), imported by relative path from `../../packages/core/src/taxonomy/snapshot`.
- Produces (pure functions; inputs are file contents as strings):
  ```ts
  // onet.ts
  export function parseTsv(text: string): Record<string, string>[];
  export function importanceFromIm(v: number): number;              // round2((v - 1) / 4), clamped 0..1
  export function onetOccupations(f: { occupationData: string; reportedTitles: string; jobTitles: string; taskStatements: string; taskRatings: string }): OccupationRecord[];
  export function onetSkills(contentModelReference: string, ratingFiles: string[]): SkillRecord[];
  export function onetOccupationSkills(ratingFiles: string[]): OccupationSkillRecord[];
  export function onetRelations(relatedOccupations: string): RelationRecord[];
  // esco.ts
  export function escoOccupations(csv: string): OccupationRecord[];
  export function escoSkills(csv: string): SkillRecord[];
  export function escoOccupationSkills(csv: string, occupationIds: Set<string>, skillIds: Set<string>): OccupationSkillRecord[];
  // crosswalk.ts
  export function crosswalkRelations(csv: string, knownIds: Set<string>): RelationRecord[];
  ```

- [ ] **Step 1: Write the failing tests**

  ```ts
  // scripts/taxonomy/onet.test.ts
  import { describe, expect, it } from "vitest";
  import { importanceFromIm, onetOccupationSkills, onetOccupations } from "./onet";

  const tsv = (rows: string[][]) => rows.map((r) => r.join("\t")).join("\r\n");
  const HEAD = ["O*NET-SOC Code", "Element ID", "Element Name", "Scale ID", "Data Value", "N",
    "Standard Error", "Lower CI Bound", "Upper CI Bound", "Recommend Suppress", "Not Relevant", "Date", "Domain Source"];
  const r = (code: string, el: string, scale: string, v: string, suppress = "N", notRelevant = "n/a") =>
    [code, el, "Name", scale, v, "8", "0.1", "0", "0", suppress, notRelevant, "08/2026", "Analyst"];

  it.each([[1, 0], [5, 1], [3.5, 0.63], [4.5, 0.88]])("IM %d → %d", (im, expected) => {
    expect(importanceFromIm(im)).toBe(expected);
  });

  it("pairs IM importance with LV level, dropping suppressed and not-relevant pairs", () => {
    const file = tsv([HEAD,
      r("15-1252.00", "2.B.3.e", "IM", "4.50"), r("15-1252.00", "2.B.3.e", "LV", "3.50", "N", "N"),
      r("15-1252.00", "2.B.1.f", "IM", "2.00", "Y"), r("15-1252.00", "2.B.1.f", "LV", "1.00", "N", "N"),
      r("29-1141.00", "2.B.3.e", "IM", "1.20"), r("29-1141.00", "2.B.3.e", "LV", "0.00", "N", "Y")]);
    expect(onetOccupationSkills([file])).toEqual([
      { occupationId: "onet:15-1252.00", skillId: "onet:2.B.3.e", importance: 0.88, level: 0.5 }]);
  });

  describe("onetOccupations", () => {
    const ids = Array.from({ length: 12 }, (_, i) => String(i + 1));
    const occ = onetOccupations({
      occupationData: tsv([["O*NET-SOC Code", "Title", "Description"], ["15-1252.00", "Software Developers", "Develop software."]]),
      reportedTitles: tsv([["O*NET-SOC Code", "Reported Job Title", "Shown in My Next Move"],
        ["15-1252.00", "Software Engineer", "Y"], ["15-1252.00", "Software Developers", "N"]]),
      jobTitles: tsv([["O*NET-SOC Code", "Job Title", "Short Title", "Source(s)"],
        ["15-1252.00", "software engineer", "n/a", "08"], ["15-1252.00", "Application Developer", "n/a", "08"]]),
      taskStatements: tsv([["O*NET-SOC Code", "Task ID", "Task", "Task Type", "Incumbents Responding", "Date", "Domain Source"],
        ...ids.map((id) => ["15-1252.00", id, `Task ${id}`, "Core", "10", "08/2026", "Incumbent"])]),
      taskRatings: tsv([["O*NET-SOC Code", "Task ID", "Scale ID", "Category", "Data Value"],
        ...ids.map((id) => ["15-1252.00", id, "IM", "n/a", String(Number(id) / 3)]),
        ["15-1252.00", "1", "RT", "n/a", "99"]]),
    });
    it("dedupes alternate titles case-insensitively and drops the title itself", () => {
      expect(occ[0]).toMatchObject({ id: "onet:15-1252.00", source: "onet", code: "15-1252.00",
        title: "Software Developers", altTitles: ["Software Engineer", "Application Developer"] });
    });
    it("keeps the 10 most important tasks (IM scale only)", () => {
      expect(occ[0]?.tasks).toEqual(Array.from({ length: 10 }, (_, i) => `Task ${12 - i}`));
    });
  });
  ```

  ```ts
  // scripts/taxonomy/esco.test.ts
  import { expect, it } from "vitest";
  import { crosswalkRelations } from "./crosswalk";
  import { escoOccupationSkills, escoOccupations, escoSkills } from "./esco";

  const U = "http://data.europa.eu/esco";
  const OCC = `conceptType,conceptUri,preferredLabel,altLabels,status,description,code
  Occupation,${U}/occupation/aaa-111,software developer,"programmer\ncoder\nProgrammer",released,Implements software.,2512.4`;
  const SKILLS = `conceptType,conceptUri,skillType,preferredLabel,status,description
  KnowledgeSkillCompetence,${U}/skill/s-1,skill/competence,Python (computer programming),released,Python.
  KnowledgeSkillCompetence,${U}/skill/s-2,skill/competence,old skill,obsolete,Gone.`;
  const REL = `occupationUri,relationType,skillType,skillUri
  ${U}/occupation/aaa-111,essential,skill/competence,${U}/skill/s-1
  ${U}/occupation/aaa-111,optional,skill/competence,${U}/skill/s-2
  ${U}/occupation/zzz-999,optional,skill/competence,${U}/skill/s-1`;

  it("reduces ESCO occupations and released skills", () => {
    expect(escoOccupations(OCC)).toEqual([{ id: "esco:aaa-111", source: "esco", code: "2512.4",
      title: "software developer", description: "Implements software.", altTitles: ["programmer", "coder"], tasks: [] }]);
    expect(escoSkills(SKILLS).map((s) => s.id)).toEqual(["esco:s-1"]);
  });
  it("maps essential to 1.0, optional to 0.5, and drops unknown ids", () => {
    expect(escoOccupationSkills(REL, new Set(["esco:aaa-111"]), new Set(["esco:s-1"]))).toEqual([
      { occupationId: "esco:aaa-111", skillId: "esco:s-1", importance: 1, level: null }]);
  });
  it("finds crosswalk columns by their values and links both directions", () => {
    const cw = `ESCO Occupation URI,ESCO Title,O*NET Id,O*NET Title,Match
  ${U}/occupation/aaa-111,software developer,15-1252.00,Software Developers,exactMatch
  ${U}/occupation/zzz-999,unknown,15-1252.00,Software Developers,closeMatch`;
    expect(crosswalkRelations(cw, new Set(["esco:aaa-111", "onet:15-1252.00"]))).toEqual([
      { fromId: "esco:aaa-111", toId: "onet:15-1252.00", kind: "crosswalk" },
      { fromId: "onet:15-1252.00", toId: "esco:aaa-111", kind: "crosswalk" }]);
  });
  ```

  The CSV template literals above must have no leading indentation in the real file (the plan indents them only for readability).

- [ ] **Step 2: Run tests to verify they fail**

  Run: `pnpm test scripts/taxonomy`
  Expected: FAIL. Modules not found (and before the `vitest.config.ts` change, "No test files found").

- [ ] **Step 3: Implement the transforms and the CLI**

  - **`parseTsv`:** split on `\n`, strip a trailing `\r`, split on tabs, and key each row by the header.
  - **`onetOccupations`:** one record per row of `Occupation Data.txt`. `altTitles` = reported titles then job titles, trimmed, deduplicated case-insensitively (first spelling wins), excluding the title, capped at 30. `tasks` = statements whose `Task ID` has an `IM` rating, sorted by IM desc then Task ID asc, top 10.
  - **`onetSkills`:** the distinct `Element ID`s across the rating files. `name` = `Element Name`; `description` from `Content Model Reference.txt`.
  - **`onetOccupationSkills`:** keep an IM row unless `Recommend Suppress = Y`. Drop the pair when its LV row has `Not Relevant = Y`. `level` = round2(LV / 7), or null when there is no LV row.
  - **`onetRelations`:** tiers `Primary-Short` and `Primary-Long`, in file order, kind `related`.
  - **ESCO:** parse with `csv-parse/sync` (`{ columns: true, bom: true, skip_empty_lines: true }`). The id is `esco:` + the last path segment of the concept URI. Keep only rows with `status = released` (when the column exists). `code` = the occupation's `code` column (falls back to the UUID); skills use the UUID. `description` = `description || definition || ""`. `altLabels` split on newlines and deduplicated as for O\*NET.
  - **`crosswalkRelations`:** the ESCO column is the first whose values match `^http://data\.europa\.eu/esco/occupation/`; the O\*NET column is the first matching `^\d{2}-\d{4}\.\d{2}$`. Emit both directions, drop unknown ids, dedupe.
  - **`build.ts`** (`node:util` `parseArgs`). Options: `--esco <dir>` (optional), `--crosswalk <file>` (optional), `--onet-zip <file>` (optional; else download), `--out <dir>` (default `data/taxonomy`). Pinned constants:
    ```ts
    const ONET = { version: "31.0", url: "https://www.onetcenter.org/dl_files/database/db_31_0_text.zip",
      sha256: "6883548adf5fde64cf6f801b35d15519c9225f2732c3cab0e281c652d16b23a9" };
    const ESCO_VERSION = "1.2.1";
    ```
    1. `fetch` the zip (or read `--onet-zip`) and verify the sha256. On a mismatch, exit 1: "O\*NET archive checksum mismatch: update ONET in scripts/taxonomy/build.ts deliberately, never by default."
    2. `unzipSync` from fflate, with a filter for the needed files under `db_31_0_text/`: `Occupation Data`, `Sample of Reported Titles`, `Job Titles`, `Task Statements`, `Task Ratings`, `Essential Skills`, `Transferable Skills`, `Knowledge`, `Related Occupations`, `Content Model Reference` (all `.txt`).
    3. With `--esco`: read `occupations_en.csv`, `skills_en.csv`, `occupationSkillRelations_en.csv`. Without it, print a warning that the snapshot is O\*NET-only.
    4. With `--crosswalk`: add its relations and record the file's basename and sha256.
    5. Sort every array by its key (id, or the composite key), so output is deterministic. Call `writeSnapshot(out, data, sources)`. Print the version, the row counts, and the total MB.
  - **`scripts/taxonomy/tsconfig.json`:** extends `../../tsconfig.base.json`, `types: ["node"]`, `noEmit`, includes `.` only.
  - **`data/taxonomy/README.md`:**
    1. **What this is:** the snapshot `init` imports, and the files in it.
    2. **Attribution:**
       - "This product includes information from the O\*NET 31.0 Database by the U.S. Department of Labor, Employment and Training Administration (USDOL/ETA). Used under the CC BY 4.0 license (https://creativecommons.org/licenses/by/4.0/). O\*NET® is a trademark of USDOL/ETA. Pathwise has modified all or some of this information (selected fields only, importance scores normalized to 0–1). USDOL/ETA has not approved, endorsed, or tested these modifications."
       - "This service uses the ESCO classification of the European Commission (ESCO v1.2.1, https://esco.ec.europa.eu)."
    3. **Rebuilding:** at https://esco.ec.europa.eu/en/use-esco/download, choose v1.2.1, "classification", English, CSV (the link arrives by email) and unzip it. Optionally save the ESCO–O\*NET crosswalk from the portal as CSV. Run `pnpm taxonomy:build --esco <dir> [--crosswalk <file>]`. A new O\*NET release means updating `ONET` (URL, version, sha256) and the attribution text together.

- [ ] **Step 4: Run tests**

  Run: `pnpm test scripts/taxonomy && pnpm typecheck && pnpm lint`
  Expected: PASS.

- [ ] **Step 5: Maintainer step: build and commit the snapshot (needs network; ESCO needs a human)**

  Run: `pnpm taxonomy:build --esco <esco-csv-dir> [--crosswalk <file>]`
  Expected: prints `onet-31.0+esco-1.2.1-<hash>`, about 1,016 O\*NET plus about 3,000 ESCO occupations, and a total under 20 MB. If no ESCO export is available, run `pnpm taxonomy:build`, check that the version reads `onet-31.0-<hash>`, and state "O\*NET-only snapshot; ESCO build outstanding" in the PR description (Spec gaps resolved, item 4).

  Then import the real snapshot into the dev database:
  `pnpm dev:db && pnpm dev:init && pnpm exec tsx --env-file=dev.env -e "const { createDb } = await import('./packages/core/src/db/index.ts'); const t = await import('./packages/core/src/taxonomy/index.ts'); const { db, pool } = createDb(process.env.DATABASE_URL); console.log(await t.importTaxonomySnapshot(db, 'data/taxonomy')); console.log(await t.searchOccupations(db, 'registered nurse', { limit: 3 })); await pool.end();"`
  Expected: `{ imported: true, version: '<the manifest version>' }`, then "Registered Nurses" (29-1141.00) first.

- [ ] **Step 6: Commit**

  ```bash
  git add -A
  git commit -m "feat: add taxonomy build script and bundled O*NET/ESCO snapshot"
  ```

---

### Task 3: Taxonomy import in `init`, the image, and compose

**Files:**
- Modify: `packages/core/src/config/env.ts` (+ `env.test.ts`), `apps/worker/src/init.ts` (+ `init.int.test.ts`), `Dockerfile`, `compose.yaml`, `.env.example`, `dev.env`, `scripts/compose-smoke.sh`

**Interfaces:**
- Consumes: `importTaxonomySnapshot` (Task 1); `data/taxonomy` (Task 2).
- Produces: `BaseConfig.taxonomyDir: string` (env `TAXONOMY_DIR`, default `/app/data/taxonomy`); `InitReport` gains `taxonomy: { imported: boolean; version: string }`.

- [ ] **Step 1: Update the tests first**

  - In `env.test.ts` "applies defaults", add `taxonomyDir: "/app/data/taxonomy"` to the expected object, which already contains Plan 2's `llmMode: "live"` (keep it). Add:
    ```ts
    it("reads TAXONOMY_DIR", () => {
      expect(loadBaseConfig({ ...DB, TAXONOMY_DIR: "./data/taxonomy" }).taxonomyDir).toBe("./data/taxonomy");
    });
    ```
  - Replace the body of `init.int.test.ts`:
    ```ts
    import { mkdtempSync, readFileSync } from "node:fs";
    import { tmpdir } from "node:os";
    import { join } from "node:path";
    import { sql } from "drizzle-orm";
    import { expect, inject, it } from "vitest";
    import { getTestDb, MIGRATIONS_FOLDER, resetDb, TAXONOMY_FIXTURE_DIR } from "../../../test/integration/db";
    import { runInit } from "./init";

    it("is idempotent, installs pg-boss, and imports the taxonomy once", async () => {
      await resetDb(getTestDb());
      const version = JSON.parse(readFileSync(join(TAXONOMY_FIXTURE_DIR, "manifest.json"), "utf8")).version;
      const env = { DATABASE_URL: inject("databaseUrl"), TAXONOMY_DIR: TAXONOMY_FIXTURE_DIR,
        SECRETS_DIR: join(mkdtempSync(join(tmpdir(), "init-")), "s") };
      expect(await runInit(env, { migrationsFolder: MIGRATIONS_FOLDER })).toEqual({
        generatedSecrets: ["APP_ENCRYPTION_KEY", "BETTER_AUTH_SECRET"], taxonomy: { imported: true, version } });
      expect(await runInit(env, { migrationsFolder: MIGRATIONS_FOLDER })).toEqual({
        generatedSecrets: [], taxonomy: { imported: false, version } });
      const r = await getTestDb().execute(sql`select 1 from information_schema.schemata where schema_name = 'pgboss'`);
      expect(r.rows).toHaveLength(1);
    });
    ```
  - In `compose-smoke.sh`:
    - After the first `up`: `dc logs init | grep -q '"msg":"taxonomy imported"'`, and assert `dc exec -T postgres psql -U pathwise -d pathwise -tAc 'select count(*) from occupations'` ≥ 1000 (the real snapshot, not the fixture).
    - After the second `up`: `[ "$(dc logs init | grep -c '"msg":"taxonomy imported"')" = 1 ]` and `dc logs init | grep -q '"msg":"taxonomy up to date"'` (spec §11: a second `up` is idempotent).

- [ ] **Step 2: Run tests to verify they fail**

  Run: `pnpm test packages/core/src/config && pnpm test:int apps/worker && bash scripts/compose-smoke.sh`
  Expected: FAIL. No `taxonomyDir`, no `taxonomy` in the report, and the smoke test can't find "taxonomy imported".

- [ ] **Step 3: Implement**

  - `env.ts`: `TAXONOMY_DIR: optional(z.string())` → `taxonomyDir: e.TAXONOMY_DIR ?? "/app/data/taxonomy"`.
  - `runInit`: after `ensureInstanceSettings`, `const taxonomy = await importTaxonomySnapshot(db, config.taxonomyDir)`. Log `{ version }` with the message `taxonomy imported` or `taxonomy up to date`. Return it in the report.
  - `Dockerfile` runtime stage: `COPY --from=build /repo/data/taxonomy /app/data/taxonomy`.
  - `compose.yaml` `x-app-env`: `TAXONOMY_DIR: ${TAXONOMY_DIR:-/app/data/taxonomy}`.
  - `.env.example`: `# Directory holding the bundled taxonomy snapshot. Only change this for a custom snapshot.` then `# TAXONOMY_DIR=/app/data/taxonomy`.
  - `dev.env`: `TAXONOMY_DIR=./data/taxonomy`.

- [ ] **Step 4: Run tests**

  Run: `pnpm test && pnpm test:int && pnpm dev:db && pnpm dev:init && pnpm dev:init && bash scripts/compose-smoke.sh`
  Expected: PASS. The first `dev:init` logs `taxonomy imported`, the second logs `taxonomy up to date`, and the smoke test ends with `SMOKE OK`.

- [ ] **Step 5: Commit**

  ```bash
  git add -A
  git commit -m "feat: import the bundled taxonomy during init"
  ```

---

### Task 4: Profile service (experiences, education, skills) and skill gaps

**Files:**
- Create: `packages/core/src/db/schema/profile.ts`, `packages/core/src/services/profile/{service.ts,version.ts,index.ts}`
- Modify: `packages/core/src/errors/index.ts` (+ `ConflictError`), `packages/core/src/db/client.ts` + `db/index.ts` (`Tx`, `DbOrTx`), `packages/core/src/db/schema/index.ts`, `packages/core/drizzle/*`, `packages/core/src/taxonomy/{import.ts,queries.ts,index.ts}` (dangling-link cleanup, `skillGapsFor`)
- Test: `packages/core/src/services/profile/profile.int.test.ts`

**Interfaces:**
- Consumes (Plan 2): `schema.userSettings` (`userId`, `profileVersion`, `updatedAt`); `getUserSettings(db, userId): Promise<UserSettings>` from `@pathwise/core/services/settings`; `seedUser` from `test/integration/fixtures.ts`. From Task 1: `matchTaxonomySkill`.
- Produces:
  ```ts
  // @pathwise/core/errors
  export class ConflictError extends Error { override name = "ConflictError" }
  // @pathwise/core/db
  export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
  export type DbOrTx = Db | Tx;
  // @pathwise/core/services/profile
  export type SourceType = "cv" | "linkedin" | "message" | "checkin" | "manual";
  export type SkillLevel = "basic" | "working" | "strong" | "expert";
  export interface Experience { id: string; title: string; organization: string | null; startDate: string | null; endDate: string | null; description: string | null; highlights: string[]; sourceType: SourceType; sourceId: string | null; version: number }
  export interface Education { id: string; institution: string; qualification: string | null; field: string | null; startDate: string | null; endDate: string | null; sourceType: SourceType; sourceId: string | null; version: number }
  export interface Skill { id: string; name: string; level: SkillLevel | null; taxonomySkillId: string | null; evidence: string | null; sourceType: SourceType; sourceId: string | null; version: number }
  export interface Profile { experiences: Experience[]; education: Education[]; skills: Skill[] }
  export const experienceInputSchema, educationInputSchema, skillInputSchema; // Zod; inputs = entity fields minus id/version, optional except title/institution/name; sourceType defaults "manual"
  export type ExperienceInput = z.input<typeof experienceInputSchema>; // likewise EducationInput, SkillInput
  export function getProfile(db: DbOrTx, userId: string): Promise<Profile>;
  export function createExperience(db: DbOrTx, userId: string, input: ExperienceInput): Promise<Experience>;
  export function updateExperience(db: DbOrTx, userId: string, id: string, patch: Partial<Omit<ExperienceInput, "sourceType" | "sourceId">>, expectedVersion?: number): Promise<Experience>;
  export function deleteExperience(db: DbOrTx, userId: string, id: string): Promise<void>;
  // same trio: createEducation/updateEducation/deleteEducation, createSkill/updateSkill/deleteSkill
  export function bumpProfileVersion(db: DbOrTx, userId: string): Promise<void>;   // version.ts
  // @pathwise/core/taxonomy
  export interface SkillGap { skill: string; taxonomySkillId: string | null; importance: number; note: string } // re-exported by services/paths in Task 7
  export function skillGapsFor(db: DbOrTx, userId: string, occupationId: string, limit?: number): Promise<SkillGap[]>;
  ```
- Test helper: none new. Integration tests get users from Plan 2's `seedUser(db, id, role?)` in `test/integration/fixtures.ts` (`name` = id, `email` = `${id}@x.io`, role default `user`); contract §9 makes that file the only source of test users.

- [ ] **Step 1: Schema**

  `profile.ts` (this task adds only the first three tables). All three get `id uuid pk defaultRandom`, `user_id text not null → user(id) on delete cascade`, `source_type text not null default 'manual'` (check `in ('cv','linkedin','message','checkin','manual')`), `source_id text`, `version integer not null default 1`, `created_at`/`updated_at timestamptz not null default now()`, and an index on `user_id`.
  - `experiences`: `title text not null`, `organization text`, `start_date text`, `end_date text`, `description text`, `highlights jsonb $type<string[]> not null default []`.
  - `education`: `institution text not null`, `qualification text`, `field text`, `start_date text`, `end_date text`.
  - `skills`: `name text not null`, `level text` (check null or `in ('basic','working','strong','expert')`), `taxonomy_skill_id text` (no FK; Spec gaps resolved, item 2), `evidence text`.

  Run: `pnpm --filter @pathwise/core db:generate`
  Expected: a migration creating the three tables.

- [ ] **Step 2: Write the failing tests**

  ```ts
  // packages/core/src/services/profile/profile.int.test.ts
  import { mkdtempSync } from "node:fs";
  import { tmpdir } from "node:os";
  import { join } from "node:path";
  import { beforeEach, describe, expect, it } from "vitest";
  import { ZodError } from "zod";
  import { FIXTURE } from "../../../../../test/fixtures/taxonomy/records";
  import { getTestDb, resetDb, TAXONOMY_FIXTURE_DIR } from "../../../../../test/integration/db";
  import { seedUser } from "../../../../../test/integration/fixtures";
  import { ConflictError, NotFoundError } from "../../errors";
  import { importTaxonomySnapshot, skillGapsFor, writeSnapshot } from "../../taxonomy";
  import { getUserSettings } from "../settings";
  import {
    createExperience, createSkill, deleteExperience, getProfile, updateExperience, updateSkill,
  } from ".";

  const db = getTestDb();
  const profileVersion = async () => (await getUserSettings(db, "u1")).profileVersion;
  beforeEach(async () => {
    await resetDb(db);
    await seedUser(db, "u1");
    await seedUser(db, "u2");
    await importTaxonomySnapshot(db, TAXONOMY_FIXTURE_DIR);
  });

  describe("experiences", () => {
    it("lists current roles first, then by start date", async () => {
      await createExperience(db, "u1", { title: "Junior", startDate: "2015", endDate: "2018-06" });
      await createExperience(db, "u1", { title: "Lead", startDate: "2021-03" });
      await createExperience(db, "u1", { title: "Mid", startDate: "2018-07", endDate: "2021-02" });
      expect((await getProfile(db, "u1")).experiences.map((e) => e.title)).toEqual(["Lead", "Mid", "Junior"]);
    });
    it.each([
      [{ title: "" }, "Enter a title."],
      [{ title: "X", startDate: "2019-13" }, "Use YYYY, YYYY-MM or YYYY-MM-DD."],
      [{ title: "X", startDate: "2020", endDate: "2019-05" }, "End date is before start date."],
    ])("rejects %o", async (input, message) => {
      const err = await createExperience(db, "u1", input).catch((e) => e);
      expect(err).toBeInstanceOf(ZodError);
      expect(err.issues[0].message).toBe(message);
    });
    it("versions updates and rejects stale ones without side effects", async () => {
      const e = await createExperience(db, "u1", { title: "Analyst" });
      expect(e).toMatchObject({ version: 1, sourceType: "manual", highlights: [] });
      expect(await updateExperience(db, "u1", e.id, { organization: "Acme" }, 1)).toMatchObject({ version: 2, organization: "Acme" });
      const before = await profileVersion();
      await expect(updateExperience(db, "u1", e.id, { title: "Lead" }, 1)).rejects.toBeInstanceOf(ConflictError);
      expect(await profileVersion()).toBe(before);
      expect((await updateExperience(db, "u1", e.id, { title: "Lead" })).version).toBe(3);
    });
    it("bumps profile_version on every change", async () => {
      expect(await profileVersion()).toBe(0);
      const e = await createExperience(db, "u1", { title: "Analyst" });
      await updateExperience(db, "u1", e.id, { title: "Senior Analyst" });
      await deleteExperience(db, "u1", e.id);
      expect(await profileVersion()).toBe(3);
      expect((await getProfile(db, "u1")).experiences).toEqual([]);
    });
    it("hides rows from other users", async () => {
      const e = await createExperience(db, "u1", { title: "Mine" });
      expect((await getProfile(db, "u2")).experiences).toEqual([]);
      await expect(updateExperience(db, "u2", e.id, { title: "Hijack" })).rejects.toBeInstanceOf(NotFoundError);
      await expect(deleteExperience(db, "u2", e.id)).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe("skills and the taxonomy", () => {
    it("links skills by exact name and relinks on rename", async () => {
      const s = await createSkill(db, "u1", { name: "programming", level: "strong" });
      expect(s.taxonomySkillId).toBe("onet:2.B.3.e");
      expect((await updateSkill(db, "u1", s.id, { name: "Basket weaving" })).taxonomySkillId).toBeNull();
      expect((await createSkill(db, "u1", { name: "Whatever", taxonomySkillId: "onet:nope" })).taxonomySkillId).toBeNull();
    });
    it("computes skill gaps from important skills the user lacks", async () => {
      await createSkill(db, "u1", { name: "Programming" });
      await createSkill(db, "u1", { name: "Mathematics" }); // links to the skill 2.A.1.e, not the knowledge 2.C.4.a
      expect(await skillGapsFor(db, "u1", "onet:15-1252.00")).toEqual([
        { skill: "Computers and Electronics", taxonomySkillId: "onet:2.C.3.a", importance: 0.88, note: "Important for Software Developers" },
        { skill: "Critical Thinking", taxonomySkillId: "onet:2.A.2.a", importance: 0.72, note: "Important for Software Developers" },
      ]);
      await expect(skillGapsFor(db, "u1", "onet:00-0000.00")).rejects.toBeInstanceOf(NotFoundError);
    });
    it("keeps skill links across a taxonomy upgrade unless the skill was removed (Review Focus 3)", async () => {
      await createSkill(db, "u1", { name: "Programming" });
      await createSkill(db, "u1", { name: "Service Orientation" });
      const v2 = mkdtempSync(join(tmpdir(), "tax-"));
      await writeSnapshot(v2, { ...FIXTURE,
        skills: FIXTURE.skills.filter((s) => s.id !== "onet:2.B.1.f"),
        occupationSkills: FIXTURE.occupationSkills.filter((x) => x.skillId !== "onet:2.B.1.f") },
        { onet: null, esco: null, crosswalk: null });
      await importTaxonomySnapshot(db, v2);
      expect((await getProfile(db, "u1")).skills.map((s) => [s.name, s.taxonomySkillId])).toEqual([
        ["Programming", "onet:2.B.3.e"], ["Service Orientation", null]]);
    });
  });
  ```

- [ ] **Step 3: Run tests to verify they fail**

  Run: `pnpm test:int packages/core/src/services/profile`
  Expected: FAIL. `.` does not resolve; `skillGapsFor` is missing.

- [ ] **Step 4: Implement**

  - **Partial date:** `z.string().regex(/^\d{4}(-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?)?$/, "Use YYYY, YYYY-MM or YYYY-MM-DD.")`, nullable and optional. Add a refine on the object: when both dates are present, `endDate.padEnd(10, "9") >= startDate`, with message `"End date is before start date."` at path `endDate`.
  - **Messages:** title → `"Enter a title."`, institution → `"Enter an institution."`, skill name → `"Enter a skill."`. Patches validate with `.partial()` plus the same refine, merged with the stored row before checking.
  - **Ordering:** experiences and education by `end_date is null desc, start_date desc nulls last, created_at desc`; skills by `lower(name)`.
  - **Updates:** `update … set …, version = version + 1, updated_at = now() where id = $id and user_id = $user [and version = $expected] returning *`. On zero rows, look the row up with the same `id`/`user_id`: absent → `NotFoundError`, present → `ConflictError("This item changed since you loaded it.")`.
  - **Writes:** every create, update, and delete runs in `db.transaction(tx => { …; await bumpProfileVersion(tx, userId) })`.
  - **`bumpProfileVersion`:** `insert into user_settings (user_id, profile_version) values ($1, 1) on conflict (user_id) do update set profile_version = user_settings.profile_version + 1, updated_at = now()`.
  - **Skill linking:**
    - Resolve the link before opening the write transaction (the taxonomy queries take `Db`).
    - `createSkill`: with no `taxonomySkillId`, use `matchTaxonomySkill(name)`. With one, keep it only if that id exists in `taxonomy_skills`.
    - `updateSkill`: when `name` changes and `taxonomySkillId` isn't in the patch, re-match.
  - **`skillGapsFor`:** load the occupation (by id; `NotFoundError` if absent). Select its skills with `importance >= 0.5`, excluding:
    - ids in the user's `skills.taxonomy_skill_id`;
    - names whose `lower(name)` is in the user's skill names or in the names of their linked taxonomy skills.

    Order by importance desc, then name; limit `limit ?? 10`. `note` = `` `Important for ${occupation.title}` ``.
  - **`importTaxonomySnapshot`:** before setting `taxonomy_meta`, run `update skills set taxonomy_skill_id = null where taxonomy_skill_id is not null and taxonomy_skill_id not in (select id from taxonomy_skills)`. Do not bump `version`: this is a system change and must not make pending proposals stale.

- [ ] **Step 5: Run tests**

  Run: `pnpm test:int && pnpm lint && pnpm typecheck`
  Expected: PASS.

- [ ] **Step 6: Commit**

  ```bash
  git add -A
  git commit -m "feat: add profile service with versioning and skill gaps"
  ```

---

### Task 5: Memory service

**Files:**
- Modify: `packages/core/src/db/schema/profile.ts` (+ `memory_items`), `packages/core/drizzle/*`
- Create: `packages/core/src/services/memory/{service.ts,index.ts}`
- Test: `packages/core/src/services/memory/memory.int.test.ts`

**Interfaces:**
- Consumes: `bumpProfileVersion`, `SourceType` (Task 4); `anyVector`, `tsvector` (Task 1).
- Produces (`@pathwise/core/services/memory`): `MemoryCategory`, `MemoryStatus`, `MemoryItem`, `PROFILE_MEMORY_CATEGORIES`, `listMemory`, `addMemory`, `updateMemory`, `setMemoryStatus`, `deleteMemory`, with the exact signatures in contract §5. Additions:
  - `memoryInputSchema` (Zod for the `addMemory` input).
  - `listMemory` defaults to `status: ["active"]` and returns newest first.

- [ ] **Step 1: Schema**

  `memory_items`:
  - the standard user-owned columns plus `version`;
  - `category text not null` (check: the nine values), `content text not null`;
  - `source_type` / `source_id` as in Task 4;
  - `confidence double precision not null default 1` (check 0–1), `sensitive boolean not null default false`;
  - `status text not null default 'active'` (check: the four values);
  - `supersedes_id uuid → memory_items(id) on delete set null` (use `(): AnyPgColumn => memoryItems.id`);
  - `embedding anyVector`, `embedding_model text`;
  - `search tsvector generated always as (to_tsvector('english', "content")) stored`;
  - indexes on `(user_id, status)` and GIN on `search`.

  Run: `pnpm --filter @pathwise/core db:generate`
  Expected: a migration creating `memory_items` with a `vector` column (no dimension).

- [ ] **Step 2: Write the failing tests**

  ```ts
  // packages/core/src/services/memory/memory.int.test.ts
  import { eq, sql } from "drizzle-orm";
  import { beforeEach, describe, expect, it } from "vitest";
  import { getTestDb, resetDb } from "../../../../../test/integration/db";
  import { seedUser } from "../../../../../test/integration/fixtures";
  import { schema } from "../../db";
  import { ConflictError, NotFoundError } from "../../errors";
  import { getUserSettings } from "../settings";
  import { addMemory, deleteMemory, listMemory, PROFILE_MEMORY_CATEGORIES, setMemoryStatus, updateMemory } from ".";

  const db = getTestDb();
  const pv = async () => (await getUserSettings(db, "u1")).profileVersion;
  const mem = (content: string, over: Partial<Parameters<typeof addMemory>[2]> = {}) =>
    addMemory(db, "u1", { category: "value", content, sourceType: "manual", sourceId: null,
      confidence: 1, sensitive: false, status: "active", ...over });
  beforeEach(async () => { await resetDb(db); await seedUser(db, "u1"); await seedUser(db, "u2"); });

  describe("memory", () => {
    it("lists only active items by default and filters by category", async () => {
      await mem("Autonomy");
      await mem("Has two kids", { category: "constraint", status: "pending", sensitive: true });
      await mem("Hates commuting", { category: "drain" });
      expect((await listMemory(db, "u1")).map((m) => m.content)).toEqual(["Hates commuting", "Autonomy"]);
      expect((await listMemory(db, "u1", { status: ["pending"] })).map((m) => m.content)).toEqual(["Has two kids"]);
      expect((await listMemory(db, "u1", { categories: ["drain"] })).map((m) => m.content)).toEqual(["Hates commuting"]);
      expect(await listMemory(db, "u2")).toEqual([]);
    });
    it("bumps profile_version only when the active set changes", async () => {
      const p = await mem("Pending thing", { status: "pending" });
      expect(await pv()).toBe(0);
      await setMemoryStatus(db, "u1", p.id, "active");
      expect(await pv()).toBe(1);
      await expect(setMemoryStatus(db, "u1", p.id, "rejected")).rejects.toBeInstanceOf(ConflictError);
      const q = await mem("Another", { status: "pending" });
      await setMemoryStatus(db, "u1", q.id, "rejected");
      expect(await pv()).toBe(1);
    });
    it("supersedes the old item", async () => {
      const old = await mem("Salary floor 50k", { category: "constraint" });
      const next = await mem("Salary floor 60k", { category: "constraint", supersedesId: old.id });
      expect(next.supersedesId).toBe(old.id);
      expect((await listMemory(db, "u1")).map((m) => m.content)).toEqual(["Salary floor 60k"]);
      expect((await listMemory(db, "u1", { status: ["superseded"] }))[0]).toMatchObject({ id: old.id, version: 2 });
      const theirs = await addMemory(db, "u2", { category: "value", content: "x", sourceType: "manual",
        sourceId: null, confidence: 1, sensitive: false, status: "active" });
      await expect(mem("y", { supersedesId: theirs.id })).rejects.toBeInstanceOf(NotFoundError);
    });
    it("clears the embedding when content changes, but not for a category change", async () => {
      const m = await mem("Remote work");
      await db.update(schema.memoryItems).set({ embedding: [0.1, 0.2, 0.3], embeddingModel: "m1" })
        .where(eq(schema.memoryItems.id, m.id));
      await updateMemory(db, "u1", m.id, { category: "preference" });
      let [row] = await db.select().from(schema.memoryItems).where(eq(schema.memoryItems.id, m.id));
      expect(row).toMatchObject({ embedding: [0.1, 0.2, 0.3], embeddingModel: "m1", version: 2 });
      await updateMemory(db, "u1", m.id, { content: "Fully remote work" }, 2);
      [row] = await db.select().from(schema.memoryItems).where(eq(schema.memoryItems.id, m.id));
      expect(row).toMatchObject({ embedding: null, embeddingModel: null, version: 3 });
      const hit = await db.execute(sql`select 1 from memory_items where search @@ websearch_to_tsquery('english', 'remote')`);
      expect(hit.rows).toHaveLength(1);
    });
    it("deletes and isolates", async () => {
      const m = await mem("Autonomy");
      await expect(deleteMemory(db, "u2", m.id)).rejects.toBeInstanceOf(NotFoundError);
      await deleteMemory(db, "u1", m.id);
      expect(await listMemory(db, "u1")).toEqual([]);
      expect(await pv()).toBe(2);
    });
    it("exposes the Profile categories", () => {
      expect(PROFILE_MEMORY_CATEGORIES).toEqual(["value", "constraint", "aspiration", "energizer", "drain", "preference"]);
    });
  });
  ```

- [ ] **Step 3: Run tests to verify they fail**

  Run: `pnpm test:int packages/core/src/services/memory`
  Expected: FAIL. `.` does not resolve.

- [ ] **Step 4: Implement**

  - `memoryInputSchema`: content trimmed, 1–1000 characters (`"Enter something to remember."`); confidence 0–1.
  - `addMemory`, in one transaction:
    - with `supersedesId`, the old row must belong to the user and be `active` (`NotFoundError` / `ConflictError` otherwise); set it to `superseded` and bump its version;
    - insert the new row;
    - bump `profile_version` if the new status is `active` or an item was superseded.
  - `updateMemory`: same optimistic pattern as Task 4. A `content` change also sets `embedding = null, embedding_model = null`. Bump `profile_version` when the item is active.
  - `setMemoryStatus`: only from `pending` (otherwise `ConflictError("Only pending items can be confirmed or dismissed.")`). Bump `profile_version` when the new status is `active`.
  - `deleteMemory`: hard delete. Bump `profile_version` when the item was active.

- [ ] **Step 5: Run tests**

  Run: `pnpm test:int packages/core/src/services && pnpm typecheck`
  Expected: PASS.

- [ ] **Step 6: Commit**

  ```bash
  git add -A
  git commit -m "feat: add memory service with statuses and supersession"
  ```

---

### Task 6: Stories service

**Files:**
- Modify: `packages/core/src/db/schema/profile.ts` (+ `stories`), `packages/core/drizzle/*`
- Create: `packages/core/src/services/stories/{service.ts,index.ts}`
- Test: `packages/core/src/services/stories/stories.int.test.ts`

**Interfaces:**
- Consumes: `SourceType` (Task 4); `anyVector`, `tsvector` (Task 1).
- Produces (`@pathwise/core/services/stories`):
  ```ts
  export const storyInputSchema; // { title: 1–200; situation, task, action, result: string ≤ 4000 (default ""); metrics: string | null (≤ 500, default null); skills: string[] (each 1–100, ≤ 20, trimmed, deduped case-insensitively, default []) }
  export type StoryInput = z.input<typeof storyInputSchema>;
  export interface Story { id: string; title: string; situation: string; task: string; action: string; result: string; metrics: string | null; skills: string[]; sourceType: SourceType; sourceId: string | null; version: number }
  export function listStories(db, userId): Promise<Story[]>;            // newest first
  export function getStory(db, userId, id): Promise<Story>;             // NotFoundError
  export function createStory(db, userId, input: StoryInput & { sourceType?: SourceType; sourceId?: string | null }): Promise<Story>;
  export function updateStory(db, userId, id, patch: Partial<StoryInput>, expectedVersion?: number): Promise<Story>;
  export function deleteStory(db, userId, id): Promise<void>;
  ```

- [ ] **Step 1: Schema**

  `stories`:
  - the standard user-owned columns plus `version`;
  - `title text not null`, `situation`/`task`/`action`/`result text not null default ''`, `metrics text`, `skills text[] not null default '{}'`;
  - `source_type`, `source_id`, `embedding anyVector`, `embedding_model text`;
  - `search tsvector generated always as (setweight(to_tsvector('english', "title" || ' ' || immutable_array_to_string("skills", ' ')), 'A') || setweight(to_tsvector('english', "situation" || ' ' || "task" || ' ' || "action" || ' ' || "result" || ' ' || coalesce("metrics", '')), 'B')) stored`;
  - GIN on `search`; index on `user_id`.

  Run: `pnpm --filter @pathwise/core db:generate`
  Expected: a migration creating `stories`.

- [ ] **Step 2: Write the failing tests**

  ```ts
  // packages/core/src/services/stories/stories.int.test.ts
  import { eq, sql } from "drizzle-orm";
  import { beforeEach, expect, it } from "vitest";
  import { ZodError } from "zod";
  import { getTestDb, resetDb } from "../../../../../test/integration/db";
  import { seedUser } from "../../../../../test/integration/fixtures";
  import { schema } from "../../db";
  import { ConflictError, NotFoundError } from "../../errors";
  import { createStory, deleteStory, getStory, listStories, updateStory } from ".";

  const db = getTestDb();
  const STORY = { title: "Cut report time by 80%", situation: "Weekly report took 2 days.", task: "Speed it up.",
    action: "Automated it with SQL and Python.", result: "Takes 3 hours.", metrics: "80% faster", skills: ["SQL", " sql ", "Python"] };
  beforeEach(async () => { await resetDb(db); await seedUser(db, "u1"); await seedUser(db, "u2"); });

  it("creates, normalizes skills, and finds stories by skill in full text", async () => {
    const s = await createStory(db, "u1", STORY);
    expect(s).toMatchObject({ skills: ["SQL", "Python"], sourceType: "manual", version: 1 });
    const hit = await db.execute(sql`select id from stories where search @@ websearch_to_tsquery('english', 'python')`);
    expect(hit.rows).toEqual([{ id: s.id }]);
    await expect(createStory(db, "u1", { ...STORY, title: " " })).rejects.toBeInstanceOf(ZodError);
  });
  it("versions updates and clears the embedding when text changes", async () => {
    const s = await createStory(db, "u1", STORY);
    await db.update(schema.stories).set({ embedding: [1, 0], embeddingModel: "m1" }).where(eq(schema.stories.id, s.id));
    expect(await updateStory(db, "u1", s.id, { result: "Takes 2 hours." }, 1)).toMatchObject({ version: 2, result: "Takes 2 hours." });
    const [row] = await db.select().from(schema.stories).where(eq(schema.stories.id, s.id));
    expect(row).toMatchObject({ embedding: null, embeddingModel: null });
    await expect(updateStory(db, "u1", s.id, { title: "x" }, 1)).rejects.toBeInstanceOf(ConflictError);
  });
  it("isolates users", async () => {
    const s = await createStory(db, "u1", STORY);
    expect(await listStories(db, "u2")).toEqual([]);
    await expect(getStory(db, "u2", s.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(deleteStory(db, "u2", s.id)).rejects.toBeInstanceOf(NotFoundError);
    await deleteStory(db, "u1", s.id);
    expect(await listStories(db, "u1")).toEqual([]);
  });
  ```

- [ ] **Step 3: Run tests to verify they fail**

  Run: `pnpm test:int packages/core/src/services/stories`
  Expected: FAIL. `.` does not resolve.

- [ ] **Step 4: Implement** with the same optimistic-update pattern. A change to any of `title`, `situation`, `task`, `action`, `result`, `metrics`, or `skills` nulls the embedding. Stories do not bump `profile_version` (the snapshot covers Profile and memory only, spec §6.2).

- [ ] **Step 5: Run tests**

  Run: `pnpm test:int packages/core/src/services/stories && pnpm typecheck`
  Expected: PASS.

- [ ] **Step 6: Commit**

  ```bash
  git add -A
  git commit -m "feat: add stories service"
  ```

---

### Task 7: Career paths and plan services

**Files:**
- Create: `packages/core/src/db/schema/direction.ts`, `packages/core/src/services/paths/{schemas.ts,service.ts,index.ts}`, `packages/core/src/services/plan/{week.ts,service.ts,index.ts,test-fixtures.ts}`
- Modify: `packages/core/src/db/schema/index.ts`, `packages/core/drizzle/*`, `packages/core/package.json` (`date-fns`, `@date-fns/tz`)
- Test: `packages/core/src/services/plan/week.test.ts`, `packages/core/src/services/plan/plan.int.test.ts`

**Interfaces:**
- Consumes: `SkillGap` (Task 4), `ConflictError`, `DbOrTx`.
- Produces:
  ```ts
  // @pathwise/core/services/paths. schemas.ts holds RouteStep, Feasibility, CareerPathInput, CareerPath
  // exactly as in contract §5, plus `export type { SkillGap } from "../../taxonomy"`, and imports nothing from db.
  export const careerPathInputSchema: z.ZodType<CareerPathInput>; // title 1–200; ≤ 10 codes; route ≤ 12; gaps ≤ 30; timeMonths ints 0–240 with min ≤ max ("Minimum time is longer than maximum."); risks/mustBeTrue ≤ 10
  export function listPaths(db, userId, filter?: { status?: CareerPath["status"][] }): Promise<CareerPath[]>; // newest first
  export function savePath(db, userId, input: CareerPathInput): Promise<CareerPath>;                      // status explored
  export function setPathStatus(db, userId, id, status: CareerPath["status"]): Promise<CareerPath>;
  export function deletePath(db, userId, id): Promise<void>;
  // @pathwise/core/services/plan
  export function mondayOf(date: Date, timeZone: string): string;   // week.ts
  export function weekStartOf(ymd: string): string;                 // week.ts: Monday of a calendar date, no timezone
  export const milestoneInputSchema;  // { title 1–200 ("Enter a milestone."); description?: string | null ≤ 4000; targetDate?: "YYYY-MM-DD" | null }
  export const actionInputSchema;     // { title 1–200 ("Enter an action."); notes?: string | null; weekOf: Monday "YYYY-MM-DD" ("Week must start on a Monday."); milestoneId?: string | null }
  export const createPlanInputSchema; // { northStar 1–500 ("Enter a north star."); careerPathId?: uuid; milestones: milestoneInput[] ≤ 12; actions: (actionInput minus milestoneId, plus milestoneIndex?: int)[] ≤ 50 }
  export type MilestoneInput = z.input<typeof milestoneInputSchema>;
  export type ActionInput = z.input<typeof actionInputSchema>;
  export interface Milestone { id: string; title: string; description: string | null; targetDate: string | null; position: number; status: "open" | "done" | "dropped"; version: number }
  export interface Action { id: string; milestoneId: string | null; title: string; notes: string | null; weekOf: string; status: "todo" | "done" | "skipped"; doneAt: Date | null; version: number }
  export interface ActivePlan { id: string; northStar: string; careerPathId: string | null; version: number; milestones: Milestone[]; actions: Action[] }
  export function getActivePlan(db, userId): Promise<ActivePlan | null>;
  export function createPlan(db, userId, input: z.input<typeof createPlanInputSchema>): Promise<ActivePlan>;
  export function updatePlan(db, userId, planId, patch: { northStar?: string }, expectedVersion?: number): Promise<ActivePlan>;
  export function addMilestone(db, userId, planId, input): Promise<Milestone>;                      // position = max + 1
  export function updateMilestone(db, userId, milestoneId, patch: Partial<MilestoneInput> & { status?: Milestone["status"]; position?: number }, expectedVersion?: number): Promise<Milestone>;
  export function removeMilestone(db, userId, milestoneId): Promise<void>;
  export function addAction(db, userId, planId, input: ActionInput): Promise<Action>;
  export function updateAction(db, userId, actionId, patch: Partial<ActionInput>, expectedVersion?: number): Promise<Action>;
  export function removeAction(db, userId, actionId): Promise<void>;
  export function setActionStatus(db, userId, actionId, status: Action["status"], expectedVersion?: number): Promise<Action>;
  export function actionsForWeek(db, userId, weekOf: string): Promise<Action[]>;                    // active plan only
  ```

- [ ] **Step 1: Schema**

  Every table gets the standard user-owned columns (`user_id` on child tables too, so every query can scope by it), `version`, and timestamps.
  - `career_paths`: `title`, `occupation_codes text[] default '{}'`, `rationale text not null`, `route jsonb $type<RouteStep[]>`, `skill_gaps jsonb $type<SkillGap[]>`, `feasibility jsonb $type<Feasibility>` (all three not null), `status text default 'explored'` (check).
  - `plans`: `north_star text not null`, `career_path_id uuid → career_paths on delete set null`, `status text not null default 'active'` (check `active|archived`); `uniqueIndex("plans_one_active").on(t.userId).where(sql\`status = 'active'\`)`.
  - `milestones`: `plan_id uuid not null → plans on delete cascade`, `title`, `description`, `target_date date` (mode string), `position integer not null`, `status text default 'open'` (check).
  - `actions`: `plan_id` (cascade), `milestone_id uuid → milestones on delete set null`, `title`, `notes`, `week_of date not null` (mode string, check `extract(isodow from week_of) = 1`), `status text default 'todo'` (check), `done_at timestamptz`; index `(user_id, week_of)`.

  Run: `pnpm --filter @pathwise/core db:generate`
  Expected: a migration with the partial unique index and the Monday check.

- [ ] **Step 2: Write the failing tests**

  ```ts
  // packages/core/src/services/plan/week.test.ts
  import { describe, expect, it } from "vitest";
  import { mondayOf, weekStartOf } from "./week";

  describe("mondayOf (Review Focus 2)", () => {
    it.each([
      ["2026-10-11T23:30:00Z", "UTC", "2026-10-05"],
      ["2026-10-11T23:30:00Z", "Pacific/Auckland", "2026-10-12"],    // Monday 12:30 local
      ["2026-10-12T03:00:00Z", "America/Los_Angeles", "2026-10-05"], // Sunday 20:00 local
      ["2026-11-02T07:30:00Z", "America/Los_Angeles", "2026-10-26"], // Sunday 23:30 PST, the day DST ended
      ["2026-11-02T08:30:00Z", "America/Los_Angeles", "2026-11-02"], // Monday 00:30 PST
      ["2026-03-29T22:30:00Z", "Europe/London", "2026-03-23"],       // Sunday 23:30 BST, the day DST began
      ["2026-03-29T23:30:00Z", "Europe/London", "2026-03-30"],       // Monday 00:30 BST
    ])("%s in %s → %s", (iso, tz, expected) => {
      expect(mondayOf(new Date(iso), tz)).toBe(expected);
    });
  });
  it.each([["2026-10-12", "2026-10-12"], ["2026-10-14", "2026-10-12"], ["2026-10-18", "2026-10-12"],
    ["2027-01-01", "2026-12-28"]])("weekStartOf(%s) = %s", (d, expected) => {
    expect(weekStartOf(d)).toBe(expected);
  });
  ```

  ```ts
  // packages/core/src/services/plan/plan.int.test.ts
  import { eq } from "drizzle-orm";
  import { beforeEach, describe, expect, it } from "vitest";
  import { ZodError } from "zod";
  import { getTestDb, resetDb } from "../../../../../test/integration/db";
  import { seedUser } from "../../../../../test/integration/fixtures";
  import { schema } from "../../db";
  import { ConflictError, NotFoundError } from "../../errors";
  import { deletePath, listPaths, savePath } from "../paths";
  import {
    actionsForWeek, addAction, addMilestone, createPlan, getActivePlan, removeMilestone,
    setActionStatus, updateAction, updatePlan,
  } from ".";
  import { PATH } from "./test-fixtures";

  // test-fixtures.ts (shared with the proposals tests; a plain module, not a test file):
  // export const PATH: CareerPathInput = { title: "Data analyst", occupationCodes: ["15-2051.00"], rationale: "Likes numbers.",
  //   route: [{ title: "Reporting analyst", kind: "role", detail: "Internal move", isBridgeRole: true }],
  //   skillGaps: [{ skill: "SQL", taxonomySkillId: null, importance: 0.8, note: "" }],
  //   feasibility: { timeMonths: { min: 6, max: 12 }, cost: "Low", risks: ["Junior pay"], mustBeTrue: ["10 h/week"] } };
  const db = getTestDb();
  const empty = (northStar: string) => ({ northStar, milestones: [], actions: [] });
  beforeEach(async () => { await resetDb(db); await seedUser(db, "u1"); await seedUser(db, "u2"); });

  describe("paths", () => {
    it("validates, saves as explored, and isolates", async () => {
      await expect(savePath(db, "u1", { ...PATH, feasibility: { ...PATH.feasibility, timeMonths: { min: 9, max: 3 } } }))
        .rejects.toBeInstanceOf(ZodError);
      const p = await savePath(db, "u1", PATH);
      expect(p).toMatchObject({ status: "explored", version: 1, route: PATH.route });
      await expect(deletePath(db, "u2", p.id)).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe("plans", () => {
    it("creates a plan with milestones and actions and marks the path chosen", async () => {
      const path = await savePath(db, "u1", PATH);
      const plan = await createPlan(db, "u1", { northStar: "Data analyst by 2027", careerPathId: path.id,
        milestones: [{ title: "SQL" }, { title: "Portfolio", targetDate: "2027-03-31" }],
        actions: [{ title: "5 exercises", weekOf: "2026-10-12", milestoneIndex: 0 }, { title: "Pick a dataset", weekOf: "2026-10-19" }] });
      expect(plan.milestones.map((m) => [m.title, m.position, m.status])).toEqual([["SQL", 0, "open"], ["Portfolio", 1, "open"]]);
      expect(plan.actions[0]).toMatchObject({ title: "5 exercises", milestoneId: plan.milestones[0]?.id, status: "todo", doneAt: null });
      expect((await listPaths(db, "u1"))[0]?.status).toBe("chosen");
      expect((await actionsForWeek(db, "u1", "2026-10-19")).map((a) => a.title)).toEqual(["Pick a dataset"]);
    });
    it("archives the previous plan, and concurrent creates leave one active plan (Review Focus 4)", async () => {
      await createPlan(db, "u1", empty("A"));
      await Promise.all([createPlan(db, "u1", empty("B")), createPlan(db, "u1", empty("C"))]);
      const rows = await db.select().from(schema.plans).where(eq(schema.plans.userId, "u1"));
      expect(rows).toHaveLength(3);
      expect(rows.filter((r) => r.status === "active")).toHaveLength(1);
      expect(["B", "C"]).toContain((await getActivePlan(db, "u1"))?.northStar);
    });
    it("bumps plans.version on structural edits only", async () => {
      const plan = await createPlan(db, "u1", { ...empty("A"), actions: [{ title: "x", weekOf: "2026-10-12" }] });
      const actionId = plan.actions[0]?.id ?? "";
      const m = await addMilestone(db, "u1", plan.id, { title: "M" });
      await updateAction(db, "u1", actionId, { milestoneId: m.id });
      const done = await setActionStatus(db, "u1", actionId, "done");
      expect(done).toMatchObject({ status: "done", version: 3, doneAt: expect.any(Date) });
      expect((await getActivePlan(db, "u1"))?.version).toBe(3);
      await expect(setActionStatus(db, "u1", actionId, "todo", 1)).rejects.toBeInstanceOf(ConflictError);
      expect((await setActionStatus(db, "u1", actionId, "todo", 3)).doneAt).toBeNull();
      await removeMilestone(db, "u1", m.id);
      expect((await getActivePlan(db, "u1"))?.actions[0]?.milestoneId).toBeNull();
    });
    it("rejects non-Monday weeks, stale edits, archived plans, and other users", async () => {
      const a = await createPlan(db, "u1", empty("A"));
      await expect(addAction(db, "u1", a.id, { title: "x", weekOf: "2026-10-13" })).rejects.toBeInstanceOf(ZodError);
      await expect(updatePlan(db, "u1", a.id, { northStar: "B" }, 7)).rejects.toBeInstanceOf(ConflictError);
      await expect(addMilestone(db, "u2", a.id, { title: "M" })).rejects.toBeInstanceOf(NotFoundError);
      await createPlan(db, "u1", empty("Next"));
      await expect(addMilestone(db, "u1", a.id, { title: "M" })).rejects.toBeInstanceOf(ConflictError);
    });
  });
  ```

- [ ] **Step 3: Run tests to verify they fail**

  Run: `pnpm test packages/core/src/services/plan && pnpm test:int packages/core/src/services/plan`
  Expected: FAIL. Modules not found.

- [ ] **Step 4: Implement**

  - **`mondayOf`:** `format(startOfISOWeek(new TZDate(date, timeZone)), "yyyy-MM-dd")` (`TZDate` from `@date-fns/tz`; `startOfISOWeek`, `format` from `date-fns`). Anything based on `getDay()` in server time or UTC fails the Review Focus 2 vectors.
  - **`weekStartOf`:** pure UTC calendar arithmetic: `d - ((getUTCDay(d) + 6) % 7)` days.
  - **`createPlan`:** one transaction.
    1. Take `pg_advisory_xact_lock(hashtextextended('pathwise.plan:' || $userId, 0))`. This serializes creates per user, so Review Focus 4 never hits the unique index.
    2. With `careerPathId`, the path must be the user's (`NotFoundError`); set its status to `chosen` (version + 1).
    3. Archive the current active plan (version + 1). Insert the plan.
    4. Insert milestones with `position` = their index. Insert actions, mapping `milestoneIndex` → milestone id (an out-of-range index fails Zod with `"Unknown milestone."`).
  - **Structural edits** (`updatePlan`, the milestone functions, `addAction`, `updateAction`, `removeAction`): one transaction. Load the plan by id and `user_id` (`NotFoundError`). If its status is `archived`, throw `ConflictError("This plan is archived.")`. Mutate the row (with the optimistic check). Then `update plans set version = version + 1, updated_at = now()`. `milestoneId` in an action input must belong to the same plan (`NotFoundError`).
  - **`setActionStatus`:** optimistic update of the action only. `done` → `done_at = now()`; otherwise `done_at = null`. `plans.version` is unchanged.
  - **`getActivePlan`:** milestones by `position`; actions by `week_of, created_at`.

- [ ] **Step 5: Run tests**

  Run: `pnpm test && pnpm test:int packages/core/src/services && pnpm typecheck`
  Expected: PASS.

- [ ] **Step 6: Commit**

  ```bash
  git add -A
  git commit -m "feat: add career path and plan services with timezone-aware weeks"
  ```

---

### Task 8: Proposals engine

**Files:**
- Create: `packages/core/src/db/schema/proposals.ts`, `packages/core/src/services/proposals/{schemas.ts,service.ts,index.ts}`
- Modify: `packages/core/src/db/schema/index.ts`, `packages/core/drizzle/*`
- Test: `packages/core/src/services/proposals/schemas.test.ts`, `packages/core/src/services/proposals/proposals.int.test.ts`

**Interfaces:**
- Consumes: every service from Tasks 4–7 and their input schemas.
- Produces (`@pathwise/core/services/proposals`), as contract §5:
  ```ts
  export type ProposalKind = "profile_update" | "memory_add" | "memory_update" | "story_add" | "story_update" | "path_save" | "plan_create" | "plan_change" | "action_status_update";
  export type ProposalStatus = "pending" | "approved" | "rejected" | "conflicted";
  export interface ProposalPayloads {
    profile_update: { entity: "experience" | "education" | "skill"; op: "create" | "update" | "delete"; id?: string; fields?: Record<string, unknown> };
    memory_add: { category: MemoryCategory; content: string; sensitive: boolean };
    memory_update: { id: string; content?: string; category?: MemoryCategory };
    story_add: StoryInput;
    story_update: { id: string; fields: Partial<StoryInput> };
    path_save: CareerPathInput;
    plan_create: z.input<typeof createPlanInputSchema>;
    plan_change: { northStar?: string;
      milestones: { add: MilestoneInput[]; update: ({ id: string; status?: Milestone["status"] } & Partial<MilestoneInput>)[]; remove: string[] };
      actions: { add: ActionInput[]; update: ({ id: string } & Partial<ActionInput>)[]; remove: string[] } };
    action_status_update: { updates: { actionId: string; status: "done" | "skipped" | "todo"; basedOnVersion: number }[] };
  }
  export type ProposalPayload<K extends ProposalKind> = ProposalPayloads[K];
  export const proposalPayloadSchemas: { [K in ProposalKind]: z.ZodType<ProposalPayload<K>> };
  export interface Proposal { id: string; kind: ProposalKind; payload: unknown; targetId: string | null; targetVersion: number | null; status: ProposalStatus; sessionId: string | null; messageId: string | null; createdAt: Date; resolvedAt: Date | null }
  export function createProposal<K extends ProposalKind>(db, userId, input: { kind: K; payload: ProposalPayload<K>; sessionId?: string; messageId?: string }): Promise<Proposal>;
  export function listProposals(db, userId, filter?: { status?: ProposalStatus[]; sessionId?: string }): Promise<Proposal[]>; // newest first
  export function getProposal(db, userId, id): Promise<Proposal>;
  export function approveProposal(db, userId, id, opts?: { editedPayload?: unknown }): Promise<{ status: "approved" | "conflicted" }>;
  export function rejectProposal(db, userId, id): Promise<void>;
  ```

**Targets and application:**

| Kind | Target read by `createProposal` | Applied with |
|---|---|---|
| `profile_update` create | none | `create{Entity}` (`sourceType: "message"`) |
| `profile_update` update / delete | the entity row | `update{Entity}` / `delete{Entity}` |
| `memory_add` | none | `addMemory` with `status: "active"`, `confidence: 1` |
| `memory_update` | the memory item | `updateMemory` |
| `story_add` / `story_update` | none / the story | `createStory` / `updateStory` |
| `path_save` | none | `savePath` |
| `plan_create` | the active plan, or none | `createPlan` |
| `plan_change` | the active plan (required) | `updatePlan`, then milestone and action add/update/remove |
| `action_status_update` | none (per-item `basedOnVersion`) | `setActionStatus(…, basedOnVersion)` for each item |

- [ ] **Step 1: Schema**

  `proposals`:
  - `id`, `user_id` (cascade);
  - `session_id uuid`, `message_id uuid` (no FKs; Plan 4 adds them);
  - `kind text not null` (check: the nine kinds), `payload jsonb not null`;
  - `target_id uuid`, `target_version integer`;
  - `status text not null default 'pending'` (check);
  - `created_at`, `updated_at`, `resolved_at timestamptz`;
  - index `(user_id, status)`.

  Run: `pnpm --filter @pathwise/core db:generate`
  Expected: a migration creating `proposals`.

- [ ] **Step 2: Write the failing tests**

  ```ts
  // packages/core/src/services/proposals/schemas.test.ts
  import { expect, it } from "vitest";
  import { proposalPayloadSchemas as S } from "./schemas";

  it.each([
    ["memory_add", { category: "value", content: "Autonomy", sensitive: false }, true],
    ["memory_add", { category: "value", content: "", sensitive: false }, false],
    ["profile_update", { entity: "skill", op: "create", fields: { name: "SQL", level: "working" } }, true],
    ["profile_update", { entity: "experience", op: "create", fields: { organization: "Acme" } }, false], // no title
    ["profile_update", { entity: "experience", op: "update", fields: { title: "X" } }, false],          // no id
    ["profile_update", { entity: "skill", op: "delete", id: "8f0b4c1e-1d7a-4f43-9b6e-0d6f3c2a9e10" }, true],
    ["action_status_update", { updates: [] }, false],
    ["plan_create", { northStar: "N", milestones: [], actions: [{ title: "a", weekOf: "2026-10-13" }] }, false], // Tuesday
    ["plan_change", { milestones: { add: [], update: [], remove: [] }, actions: { add: [], update: [], remove: [] } }, true],
  ] as const)("%s %o valid=%s", (kind, payload, ok) => {
    expect(S[kind].safeParse(payload).success).toBe(ok);
  });
  ```

  ```ts
  // packages/core/src/services/proposals/proposals.int.test.ts
  import { beforeEach, describe, expect, it } from "vitest";
  import { ZodError } from "zod";
  import { getTestDb, resetDb } from "../../../../../test/integration/db";
  import { seedUser } from "../../../../../test/integration/fixtures";
  import { ConflictError, NotFoundError } from "../../errors";
  import { listMemory } from "../memory";
  import { listPaths, savePath } from "../paths";
  import { createPlan, getActivePlan, setActionStatus } from "../plan";
  import { PATH } from "../plan/test-fixtures";
  import { createExperience, deleteExperience, getProfile, updateExperience } from "../profile";
  import { listStories } from "../stories";
  import { approveProposal, createProposal, getProposal, listProposals, rejectProposal } from ".";

  const db = getTestDb();
  const STORY = { title: "Shipped v2", situation: "s", task: "t", action: "a", result: "r", metrics: null, skills: ["Go"] };
  beforeEach(async () => { await resetDb(db); await seedUser(db, "u1"); await seedUser(db, "u2"); });

  describe("approving applies each kind", () => {
    it("profile_update create, update, delete", async () => {
      const c = await createProposal(db, "u1", { kind: "profile_update", payload: { entity: "experience", op: "create", fields: { title: "Analyst" } } });
      expect(c).toMatchObject({ status: "pending", targetId: null, targetVersion: null });
      expect(await approveProposal(db, "u1", c.id)).toEqual({ status: "approved" });
      const [exp] = (await getProfile(db, "u1")).experiences;
      expect(exp).toMatchObject({ title: "Analyst", sourceType: "message" });
      const u = await createProposal(db, "u1", { kind: "profile_update", payload: { entity: "experience", op: "update", id: exp?.id, fields: { title: "Lead" } } });
      expect(u).toMatchObject({ targetId: exp?.id, targetVersion: 1 });
      await approveProposal(db, "u1", u.id);
      const d = await createProposal(db, "u1", { kind: "profile_update", payload: { entity: "experience", op: "delete", id: exp?.id } });
      expect(d.targetVersion).toBe(2);
      await approveProposal(db, "u1", d.id);
      expect((await getProfile(db, "u1")).experiences).toEqual([]);
    });
    it("memory_add is always active, even when sensitive", async () => {
      const p = await createProposal(db, "u1", { kind: "memory_add", messageId: "5b8e2f4a-9c1d-4e7b-8a3f-2d6c0b1e9f47",
        payload: { category: "constraint", content: "Needs visa sponsorship", sensitive: true } });
      await approveProposal(db, "u1", p.id);
      expect((await listMemory(db, "u1"))[0]).toMatchObject({ status: "active", sensitive: true,
        sourceType: "message", sourceId: "5b8e2f4a-9c1d-4e7b-8a3f-2d6c0b1e9f47", confidence: 1 });
      expect(await getProposal(db, "u1", p.id)).toMatchObject({ status: "approved", resolvedAt: expect.any(Date) });
    });
    it("story_add, path_save, and plan_create", async () => {
      for (const input of [{ kind: "story_add", payload: STORY }, { kind: "path_save", payload: PATH }] as const) {
        await approveProposal(db, "u1", (await createProposal(db, "u1", input)).id);
      }
      const [path] = await listPaths(db, "u1");
      const p = await createProposal(db, "u1", { kind: "plan_create", payload: { northStar: "N", careerPathId: path?.id,
        milestones: [{ title: "M" }], actions: [{ title: "A", weekOf: "2026-10-12", milestoneIndex: 0 }] } });
      await approveProposal(db, "u1", p.id);
      expect((await listStories(db, "u1")).map((s) => s.title)).toEqual(["Shipped v2"]);
      expect((await getActivePlan(db, "u1"))?.actions[0]?.title).toBe("A");
      expect((await listPaths(db, "u1"))[0]?.status).toBe("chosen");
    });
    it("plan_change and action_status_update", async () => {
      const plan = await createPlan(db, "u1", { northStar: "N", milestones: [{ title: "Old" }], actions: [{ title: "A", weekOf: "2026-10-12" }] });
      const [old] = plan.milestones; const [act] = plan.actions;
      const c = await createProposal(db, "u1", { kind: "plan_change", payload: { northStar: "N2",
        milestones: { add: [{ title: "New" }], update: [], remove: [old?.id ?? ""] },
        actions: { add: [{ title: "B", weekOf: "2026-10-19" }], update: [{ id: act?.id ?? "", title: "A2" }], remove: [] } } });
      expect(c).toMatchObject({ targetId: plan.id, targetVersion: 1 });
      await approveProposal(db, "u1", c.id);
      const after = await getActivePlan(db, "u1");
      expect([after?.northStar, after?.milestones.map((m) => m.title), after?.actions.map((a) => a.title)])
        .toEqual(["N2", ["New"], ["A2", "B"]]);
      const s = await createProposal(db, "u1", { kind: "action_status_update",
        payload: { updates: [{ actionId: act?.id ?? "", status: "done", basedOnVersion: 2 }] } });
      await approveProposal(db, "u1", s.id);
      expect((await getActivePlan(db, "u1"))?.actions[0]?.status).toBe("done");
    });
  });

  describe("staleness and safety", () => {
    it("conflicts when the target changed after the proposal was made (Review Focus 1)", async () => {
      const exp = await createExperience(db, "u1", { title: "Analyst" });
      const p = await createProposal(db, "u1", { kind: "profile_update", payload: { entity: "experience", op: "update", id: exp.id, fields: { title: "Senior Analyst" } } });
      await updateExperience(db, "u1", exp.id, { organization: "Acme" });
      expect(await approveProposal(db, "u1", p.id)).toEqual({ status: "conflicted" });
      expect((await getProfile(db, "u1")).experiences[0]).toMatchObject({ title: "Analyst", organization: "Acme", version: 2 });
      expect((await getProposal(db, "u1", p.id)).status).toBe("conflicted");
    });
    it("conflicts when the target was deleted, a different plan became active, or one action is stale", async () => {
      const exp = await createExperience(db, "u1", { title: "Gone" });
      const del = await createProposal(db, "u1", { kind: "profile_update", payload: { entity: "experience", op: "update", id: exp.id, fields: { title: "X" } } });
      await deleteExperience(db, "u1", exp.id);
      expect(await approveProposal(db, "u1", del.id)).toEqual({ status: "conflicted" });

      const pc = await createProposal(db, "u1", { kind: "plan_create", payload: { northStar: "Coach's", milestones: [], actions: [] } });
      const manual = await createPlan(db, "u1", { northStar: "Mine", milestones: [], actions: [{ title: "A", weekOf: "2026-10-12" }, { title: "B", weekOf: "2026-10-12" }] });
      expect(await approveProposal(db, "u1", pc.id)).toEqual({ status: "conflicted" });
      expect((await getActivePlan(db, "u1"))?.northStar).toBe("Mine");

      const [a, b] = manual.actions;
      const st = await createProposal(db, "u1", { kind: "action_status_update", payload: { updates: [
        { actionId: a?.id ?? "", status: "done", basedOnVersion: 1 }, { actionId: b?.id ?? "", status: "done", basedOnVersion: 1 }] } });
      await setActionStatus(db, "u1", b?.id ?? "", "skipped");
      expect(await approveProposal(db, "u1", st.id)).toEqual({ status: "conflicted" });
      expect((await getActivePlan(db, "u1"))?.actions.map((x) => x.status)).toEqual(["todo", "skipped"]);
    });
    it("re-validates edited payloads and refuses retargeting", async () => {
      const p = await createProposal(db, "u1", { kind: "memory_add", payload: { category: "value", content: "Autonmy", sensitive: false } });
      await expect(approveProposal(db, "u1", p.id, { editedPayload: { category: "value", content: "", sensitive: false } }))
        .rejects.toBeInstanceOf(ZodError);
      expect((await getProposal(db, "u1", p.id)).status).toBe("pending");
      await approveProposal(db, "u1", p.id, { editedPayload: { category: "value", content: "Autonomy", sensitive: false } });
      expect((await listMemory(db, "u1"))[0]?.content).toBe("Autonomy");
      const [e1, e2] = [await createExperience(db, "u1", { title: "A" }), await createExperience(db, "u1", { title: "B" })];
      const u = await createProposal(db, "u1", { kind: "profile_update", payload: { entity: "experience", op: "update", id: e1.id, fields: { title: "A2" } } });
      await expect(approveProposal(db, "u1", u.id, { editedPayload: { entity: "experience", op: "update", id: e2.id, fields: { title: "A2" } } }))
        .rejects.toBeInstanceOf(ConflictError);
    });
    it("applies once when approved twice at the same time (Review Focus 5)", async () => {
      const p = await createProposal(db, "u1", { kind: "memory_add", payload: { category: "value", content: "Autonomy", sensitive: false } });
      const results = await Promise.allSettled([approveProposal(db, "u1", p.id), approveProposal(db, "u1", p.id)]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(results.find((r) => r.status === "rejected")?.reason).toBeInstanceOf(ConflictError);
      expect(await listMemory(db, "u1")).toHaveLength(1);
      await expect(rejectProposal(db, "u1", p.id)).rejects.toBeInstanceOf(ConflictError);
    });
    it("rejects, lists, and keeps proposals private", async () => {
      const p = await createProposal(db, "u1", { kind: "story_add", payload: STORY, sessionId: "0c4d7a1e-6b2f-4c8a-9e3d-5f1a2b7c8d90" });
      await expect(getProposal(db, "u2", p.id)).rejects.toBeInstanceOf(NotFoundError);
      await expect(approveProposal(db, "u2", p.id)).rejects.toBeInstanceOf(NotFoundError);
      const theirs = await createExperience(db, "u2", { title: "Theirs" });
      await expect(createProposal(db, "u1", { kind: "profile_update", payload: { entity: "experience", op: "delete", id: theirs.id } }))
        .rejects.toBeInstanceOf(NotFoundError);
      expect((await listProposals(db, "u1", { sessionId: "0c4d7a1e-6b2f-4c8a-9e3d-5f1a2b7c8d90" })).map((x) => x.id)).toEqual([p.id]);
      await rejectProposal(db, "u1", p.id);
      expect(await listProposals(db, "u1", { status: ["pending"] })).toEqual([]);
      expect(await listStories(db, "u1")).toEqual([]);
    });
  });
  ```

- [ ] **Step 3: Run tests to verify they fail**

  Run: `pnpm test packages/core/src/services/proposals && pnpm test:int packages/core/src/services/proposals`
  Expected: FAIL. Modules not found.

- [ ] **Step 4: Implement**

  - **`schemas.ts`:**
    - Compose the Task 4–7 input schemas.
    - `profile_update`: a `superRefine` that requires `id` for update/delete and `fields` for create/update, and validates `fields` against the entity's input schema (`.partial()` for update; `sourceType`/`sourceId` are stripped).
    - `action_status_update.updates`: 1–50 items with unique `actionId`s.
    - `plan_change`: an empty diff is valid and applies nothing.
  - **`createProposal`:**
    1. Parse the payload (ZodError propagates).
    2. Read the target per the table (`NotFoundError` if missing or not the user's). `plan_change` with no active plan → `NotFoundError("No active plan.")`. Every `action_status_update` action must belong to the user (`NotFoundError`).
    3. Insert with `target_id`/`target_version`.
  - **`approveProposal`:** one `db.transaction(async (tx) => …)`.
    1. `select … from proposals where id and user_id for update`. Missing → `NotFoundError`. `status !== 'pending'` → `ConflictError("This proposal was already resolved.")`.
    2. With `editedPayload`: parse it with the kind's schema. For `profile_update`, its `entity`/`op`/`id` must equal the stored payload's; for `memory_update` / `story_update`, its `id`; for `action_status_update`, its `actionId`s must be a subset of the original. Otherwise throw `ConflictError("An edit can't change what the proposal targets.")`.
    3. Apply inside a nested `tx.transaction` (savepoint), in this order:
       - For targeted kinds, lock the target row (`select version … for update`). Missing, or version ≠ `target_version` → `ConflictError`.
       - For `plan_create`, the current active plan's id/version must equal `target_id`/`target_version` (both null when none).
       - Call the services from the table.
       - If the savepoint throws `ConflictError` or `NotFoundError`, set `status = 'conflicted'` (leave `resolved_at` null) and return `{ status: "conflicted" }`. Other errors propagate and the whole transaction rolls back.
    4. Store the applied payload in `payload`, set `status = 'approved'` and `resolved_at = now()`. Return `{ status: "approved" }`.
  - **`rejectProposal`:** same lock and pending check, then `status = 'rejected'`, `resolved_at = now()`.

- [ ] **Step 5: Run tests**

  Run: `pnpm test && pnpm test:int && pnpm lint && pnpm typecheck`
  Expected: PASS.

- [ ] **Step 6: Commit**

  ```bash
  git add -A
  git commit -m "feat: add proposals engine with staleness checks"
  ```

---

### Task 9: Profile screen

**Files:**
- Create: `apps/web/src/lib/form-error.ts`, `apps/web/src/components/{source-label.tsx,confirm-delete.tsx,pending-memory-list.tsx}`, `apps/web/src/components/ui/{textarea.tsx,checkbox.tsx}` (`pnpm dlx shadcn@latest add textarea checkbox` in `apps/web`), `apps/web/src/app/(app)/profile/{page.tsx,actions.ts,experience-section.tsx,education-section.tsx,skills-section.tsx,skill-picker.tsx,memory-section.tsx}`, `e2e/profile.spec.ts`
- Modify: `apps/web/src/components/app-nav.tsx` (link "Profile" → `/profile`, after Today/Coach/Plan and before Stories/Settings), `playwright.config.ts` (project `domain`: `testMatch: /(profile|stories|plan)\.spec\.ts/`, `dependencies: ["auth"]`)
- Test: `apps/web/src/lib/form-error.test.ts`, `e2e/profile.spec.ts`

**Interfaces:**
- Consumes: profile, memory, and taxonomy services (Tasks 1, 4, 5); `requireSession`, `getServer`.
- Produces:
  ```ts
  // apps/web/src/lib/form-error.ts
  export const CONFLICT_MESSAGE = "This changed somewhere else. Reload to see the latest version.";
  export const GONE_MESSAGE = "This item no longer exists. Reload the page.";
  export function toFormError(e: unknown): string; // ZodError → first issue message; ConflictError → CONFLICT_MESSAGE; NotFoundError → GONE_MESSAGE; anything else is rethrown
  // apps/web/src/components/source-label.tsx
  export const SOURCE_LABELS: Record<SourceType, string>;
  export function SourceLabel({ type }: { type: SourceType }): React.JSX.Element; // muted text
  // apps/web/src/components/confirm-delete.tsx (client): trigger button → "Delete this?" + "Yes, delete" / "Keep"
  export function ConfirmDelete(props: { action: (formData: FormData) => Promise<void>; fields: Record<string, string>; label?: string }): React.JSX.Element; // label default "Delete"
  // apps/web/src/components/pending-memory-list.tsx (Plans 4/5 reuse it on Today)
  export function PendingMemoryList({ items }: { items: MemoryItem[] }): React.JSX.Element | null; // null when empty
  ```
  Server actions in `profile/actions.ts` (`"use server"`; each calls `requireSession()`, then core with `session.userId`, then `revalidatePath("/profile")`; form actions return `FormState = { error?: string } | undefined` via `toFormError`): `saveExperienceAction`, `deleteExperienceAction`, `saveEducationAction`, `deleteEducationAction`, `saveSkillAction`, `deleteSkillAction`, `searchSkillsAction(query: string)` → `{ id; name; source }[]` (8 max), `saveMemoryAction`, `deleteMemoryAction`, `setMemoryStatusAction(id, "active" | "rejected")`. A save action with a hidden `id` updates, passing the hidden `version` as `expectedVersion`; without one it creates.

**Copy (exact):**

| Element | Text |
|---|---|
| Page | h1 "Profile"; intro "What I know about you. Everything here is editable." |
| Sections | h2 "Experience", "Education", "Skills", "What matters to you" |
| Memory groups | h3 per category, each a `<section aria-labelledby>` region: Values, Constraints, Aspirations, Energizers, Drains, Preferences; empty group "Nothing yet." |
| Pending | h2 "New things I learned"; per item: content, `SourceLabel`, buttons "Confirm" / "Dismiss" |
| Sources | cv "From your CV", linkedin "From your LinkedIn profile", message "From a conversation", checkin "From a check-in", manual "Added by you" |
| Add buttons | "Add experience", "Add education", "Add skill", "Add something about you" |
| Experience form | "Job title", "Organization", "Start", "End", "Description", "Highlights (one per line)"; hint under the dates "YYYY or YYYY-MM. Leave End empty if this is your current role." |
| Education form | "Institution", "Qualification", "Field of study", "Start", "End" |
| Skill form | "Skill" (combobox), "Level" (native select: "Not set", "Basic", "Working", "Strong", "Expert"), "Evidence" |
| Memory form | "Category" (native select of the 6 labels; values are the category keys), "What should I remember?" |
| Form buttons | "Save", "Cancel" |
| Item buttons | "Edit", "Delete" → inline "Delete this?" with "Yes, delete" / "Keep" (`ConfirmDelete`) |
| Experience line | `{title}` · `{organization}` · `{start} – {end ?? "present"}` (omitted when both dates are null) |
| Skill line | `{name}`, level label, badge "Linked to O*NET" / "Linked to ESCO" when linked |
| Sensitive memory | badge "Sensitive" |

- Every list renders as `<ul>` of `<li>`. Opening a form (Add or Edit) closes any other open form on the page, so labels are unique.
- **`SkillPicker`** (client):
  - Debounce 200 ms; at 2+ characters, call `searchSkillsAction` and render `<ul role="listbox">` of `<li role="option" aria-label={name}>` showing the name plus a muted "O\*NET"/"ESCO" tag.
  - Choosing an option fills the input and a hidden `taxonomySkillId`. Typing again clears the hidden field.
  - Free text is allowed; the server auto-links it.
  - The input has `role="combobox"`, `aria-expanded`, and `aria-controls`.

- [ ] **Step 1: Write the failing tests**

  ```ts
  // apps/web/src/lib/form-error.test.ts
  import { ConflictError, NotFoundError } from "@pathwise/core/errors";
  import { expect, it } from "vitest";
  import { z } from "zod";
  import { CONFLICT_MESSAGE, GONE_MESSAGE, toFormError } from "./form-error";

  it("maps domain errors to user copy", () => {
    const zod = z.object({ title: z.string().min(1, "Enter a title.") }).safeParse({ title: "" }).error;
    expect(toFormError(zod)).toBe("Enter a title.");
    expect(toFormError(new ConflictError("x"))).toBe(CONFLICT_MESSAGE);
    expect(toFormError(new NotFoundError("x"))).toBe(GONE_MESSAGE);
    expect(() => toFormError(new Error("boom"))).toThrow("boom");
  });
  ```

  ```ts
  // e2e/profile.spec.ts — self-sufficient: signs in as the admin created by auth.spec.ts
  import { expect, type Page, test } from "@playwright/test";

  test.describe.configure({ mode: "serial" });
  async function openProfile(page: Page) {
    await page.goto("/sign-in");
    await page.getByLabel("Email").fill("ada@example.com");
    await page.getByLabel("Password").fill("a-very-long-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("heading", { name: /^Welcome, / })).toBeVisible();
    await page.getByRole("link", { name: "Profile" }).click();
    await expect(page.getByRole("heading", { name: "Profile", level: 1 })).toBeVisible();
  }

  test("add, edit, and delete an experience", async ({ page }) => {
    await openProfile(page);
    await page.getByRole("button", { name: "Add experience" }).click();
    await page.getByLabel("Job title").fill("Data Analyst");
    await page.getByLabel("Organization").fill("Acme");
    await page.getByLabel("Start", { exact: true }).fill("2021-03");
    await page.getByRole("button", { name: "Save" }).click();
    const item = page.getByRole("listitem").filter({ hasText: "Data Analyst" });
    await expect(item).toContainText("Acme");
    await expect(item).toContainText("2021-03 – present");
    await expect(item).toContainText("Added by you");
    await item.getByRole("button", { name: "Edit" }).click();
    await page.getByLabel("Job title").fill("Senior Data Analyst");
    await page.getByRole("button", { name: "Save" }).click();
    const edited = page.getByRole("listitem").filter({ hasText: "Senior Data Analyst" });
    await edited.getByRole("button", { name: "Delete" }).click();
    await edited.getByRole("button", { name: "Yes, delete" }).click();
    await expect(page.getByText("Senior Data Analyst")).toHaveCount(0);
  });

  test("invalid dates are explained", async ({ page }) => {
    await openProfile(page);
    await page.getByRole("button", { name: "Add experience" }).click();
    await page.getByLabel("Job title").fill("Analyst");
    await page.getByLabel("Start", { exact: true }).fill("March 2021");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Use YYYY, YYYY-MM or YYYY-MM-DD.")).toBeVisible();
  });

  test("add a skill linked to the taxonomy", async ({ page }) => {
    await openProfile(page);
    await page.getByRole("button", { name: "Add skill" }).click();
    await page.getByLabel("Skill", { exact: true }).fill("Programm");
    await page.getByRole("option", { name: "Programming", exact: true }).click();
    await page.getByLabel("Level").selectOption("strong");
    await page.getByRole("button", { name: "Save" }).click();
    const item = page.getByRole("listitem").filter({ hasText: "Programming" });
    await expect(item).toContainText("Strong");
    await expect(item).toContainText("Linked to O*NET");
  });

  test("remember a value, then delete it", async ({ page }) => {
    await openProfile(page);
    await page.getByRole("button", { name: "Add something about you" }).click();
    await page.getByLabel("Category").selectOption("value");
    await page.getByLabel("What should I remember?").fill("Autonomy over my schedule");
    await page.getByRole("button", { name: "Save" }).click();
    const values = page.getByRole("region", { name: "Values" });
    const item = values.getByRole("listitem").filter({ hasText: "Autonomy over my schedule" });
    await expect(item).toContainText("Added by you");
    await item.getByRole("button", { name: "Delete" }).click();
    await item.getByRole("button", { name: "Yes, delete" }).click();
    await expect(values.getByText("Nothing yet.")).toBeVisible();
  });
  ```

- [ ] **Step 2: Run tests to verify they fail**

  Run: `pnpm test apps/web && pnpm e2e e2e/profile.spec.ts`
  Expected: FAIL. `./form-error` is missing; there is no Profile link.

- [ ] **Step 3: Implement** the page (a server component: `requireSession()`, then `getProfile`, `listMemory(…, { categories: PROFILE_MEMORY_CATEGORIES })`, and `listMemory(…, { status: ["pending"], categories: PROFILE_MEMORY_CATEGORIES })`), the client section components with `useActionState`, and the actions and components above. Web dependency: `zod` (for the `ZodError` instance check in `form-error.ts`).

- [ ] **Step 4: Run tests**

  Run: `pnpm test apps/web && pnpm lint && pnpm typecheck && pnpm e2e`
  Expected: PASS (auth, admin, and profile specs).

- [ ] **Step 5: Commit**

  ```bash
  git add -A
  git commit -m "feat: add Profile screen with manual editing"
  ```

---

### Task 10: Stories screen

**Files:**
- Create: `apps/web/src/app/(app)/stories/{page.tsx,actions.ts,story-form.tsx,new/page.tsx,[id]/edit/page.tsx}`, `e2e/stories.spec.ts`
- Modify: `apps/web/src/components/app-nav.tsx` (link "Stories" → `/stories`, after Profile)
- Test: `e2e/stories.spec.ts`

**Interfaces:**
- Consumes: stories service (Task 6); `toFormError`, `SourceLabel`, `ConfirmDelete` (Task 9).
- Produces: `saveStoryAction(prev, formData)` (create or update with hidden `id`/`version`; on success `redirect("/stories")`); `deleteStoryAction(formData)`.

**Copy (exact):**

| Element | Text |
|---|---|
| List page | h1 "Stories"; intro "Achievements captured once, ready to reuse."; link-button "Add story" (`/stories/new`) |
| Empty | "No stories yet. Add one, or tell your coach about something you're proud of." |
| Card | `<article>`: h2 title, `SourceLabel`, skill badges, metrics line, then labelled S/T/A/R paragraphs ("Situation", "Task", "Action", "Result"); link "Edit" (`/stories/{id}/edit`); "Delete" → "Yes, delete" / "Keep" |
| Editor | h1 "New story" / "Edit story"; labels "Title", "Situation", "Task", "Action", "Result" (textareas), "Metrics", "Skills (comma-separated)"; buttons "Save story", "Cancel" (link back) |

- [ ] **Step 1: Write the failing test**

  ```ts
  // e2e/stories.spec.ts
  import { expect, test } from "@playwright/test";

  test("write, edit, and delete a story", async ({ page }) => {
    await page.goto("/sign-in");
    await page.getByLabel("Email").fill("ada@example.com");
    await page.getByLabel("Password").fill("a-very-long-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("heading", { name: /^Welcome, / })).toBeVisible();
    await page.getByRole("link", { name: "Stories" }).click();
    await expect(page.getByText("No stories yet.")).toBeVisible();
    await page.getByRole("link", { name: "Add story" }).click();
    await page.getByLabel("Title").fill("Cut report time by 80%");
    await page.getByLabel("Situation").fill("The weekly report took two days.");
    await page.getByLabel("Task", { exact: true }).fill("Make it faster.");
    await page.getByLabel("Action", { exact: true }).fill("Automated it with SQL.");
    await page.getByLabel("Result").fill("It now takes three hours.");
    await page.getByLabel("Metrics").fill("80% faster");
    await page.getByLabel("Skills (comma-separated)").fill("SQL, Automation");
    await page.getByRole("button", { name: "Save story" }).click();
    await expect(page).toHaveURL(/\/stories$/);
    const card = page.getByRole("article").filter({ hasText: "Cut report time by 80%" });
    await expect(card).toContainText("Automation");
    await expect(card).toContainText("80% faster");
    await card.getByRole("link", { name: "Edit" }).click();
    await page.getByLabel("Title").fill("Cut weekly report time by 80%");
    await page.getByRole("button", { name: "Save story" }).click();
    const edited = page.getByRole("article").filter({ hasText: "Cut weekly report time by 80%" });
    await edited.getByRole("button", { name: "Delete" }).click();
    await edited.getByRole("button", { name: "Yes, delete" }).click();
    await expect(page.getByText("No stories yet.")).toBeVisible();
  });
  ```

- [ ] **Step 2: Run test to verify it fails**

  Run: `pnpm e2e e2e/stories.spec.ts`
  Expected: FAIL. There is no Stories link.

- [ ] **Step 3: Implement.** Skills are parsed by splitting on commas and trimming (the service dedupes). The edit page loads with `getStory`; a `NotFoundError` there calls `notFound()`.

- [ ] **Step 4: Run tests**

  Run: `pnpm lint && pnpm typecheck && pnpm e2e`
  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add -A
  git commit -m "feat: add Stories screen"
  ```

---

### Task 11: Plan screen with path comparison

**Files:**
- Create: `apps/web/src/app/(app)/plan/{page.tsx,actions.ts,compare.ts,path-comparison.tsx,milestones-section.tsx,actions-section.tsx}`, `e2e/plan.spec.ts`
- Modify: `apps/web/src/components/app-nav.tsx` (link "Plan" → `/plan`, after Today/Coach), `apps/web/package.json` (`date-fns` 4.x)
- Test: `apps/web/src/app/(app)/plan/compare.test.ts`, `e2e/plan.spec.ts`

**Interfaces:**
- Consumes: paths and plan services (Task 7); `getUserSettings`, `effectiveTimezone` (Plan 2); `toFormError`, `ConfirmDelete` (Task 9).
- Produces:
  ```ts
  // plan/compare.ts (pure; imports only types from core)
  export interface ComparisonRow { label: string; cells: string[] }
  export function comparisonRows(paths: CareerPath[]): ComparisonRow[];
  ```
  Server actions: `createPlanAction`, `updateNorthStarAction`, `addMilestoneAction`, `updateMilestoneAction`, `removeMilestoneAction`, `addActionAction`, `updateActionAction`, `removeActionAction`, `setActionStatusAction(id, status, version)`, `setPathStatusAction(id, "chosen" | "dismissed")`. Forms pass hidden `planId`/`version`. The action form's "Week of" date is normalized with `weekStartOf` before calling core.

**Copy and layout (exact):**

| Element | Text |
|---|---|
| Page | h1 "Plan" |
| No plan | "You don't have a plan yet." + form: "North star" input, "Based on path" native select ("None" + explored/chosen paths), button "Create plan" |
| North star | h2 "North star", its text, button "Edit north star" → form "North star" + "Save" / "Cancel" |
| Milestones | h2 "Milestones"; `<ol>` of `<li>`: title, target date as `d MMM yyyy`, status native select labelled "Status of {title}" (Open / Done / Dropped; saves on change, no button), "Edit", "Remove" (`ConfirmDelete` with `label="Remove"`); add form: "New milestone", "Target date", "Description", button "Add milestone" |
| Actions | h2 "Weekly actions"; one `<section aria-labelledby>` per week from the current week onwards, heading "This week" for `mondayOf(now, tz)`, else "Week of {d MMM yyyy}"; earlier weeks inside `<details>` with summary "Earlier weeks" |
| Action row | `<li>`: `Checkbox` with `aria-label="Done: {title}"` (checked when done); title (line-through when skipped); milestone badge; "Skip" (todo) or "Undo" (skipped); "Edit"; "Remove" (`ConfirmDelete` with `label="Remove"`) |
| Add action | "New action", "Week of" (date input, default this week's Monday), "Milestone (optional)" (native select, "None" + milestones), "Notes"; button "Add action" |
| Paths | h2 "Career paths"; empty "No career paths yet. Ask your coach to suggest some."; card per non-dismissed path: title, status badge (Explored / Chosen), rationale, time, checkbox "Compare {title}", buttons "Choose" (explored only) and "Dismiss"; dismissed paths inside `<details>` "Dismissed paths" |
| Comparison | when 2+ are ticked: h3 "Compare paths", a table with one column per path and rows from `comparisonRows` |

- [ ] **Step 1: Write the failing tests**

  ```ts
  // apps/web/src/app/(app)/plan/compare.test.ts
  import type { CareerPath } from "@pathwise/core/services/paths";
  import { expect, it } from "vitest";
  import { comparisonRows } from "./compare";

  const path = (title: string, min: number, max: number): CareerPath => ({
    id: title, title, status: "explored", version: 1, createdAt: new Date(), occupationCodes: [],
    rationale: `${title} fits`, route: [
      { title: "Reporting analyst", kind: "role", detail: "", isBridgeRole: true },
      { title: "SQL course", kind: "learning", detail: "", isBridgeRole: false }],
    skillGaps: [{ skill: "SQL", taxonomySkillId: null, importance: 0.8, note: "" }, { skill: "Statistics", taxonomySkillId: null, importance: 0.6, note: "" }],
    feasibility: { timeMonths: { min, max }, cost: "Low", risks: ["Pay cut", "Crowded field"], mustBeTrue: ["10 h/week"] },
  });

  it("builds the side-by-side rows", () => {
    expect(comparisonRows([path("Analyst", 6, 12), path("Engineer", 12, 12)])).toEqual([
      { label: "Why it fits", cells: ["Analyst fits", "Engineer fits"] },
      { label: "Route", cells: Array(2).fill("Reporting analyst (bridge role) → SQL course") },
      { label: "Skill gaps", cells: Array(2).fill("SQL, Statistics") },
      { label: "Time", cells: ["6–12 months", "12 months"] },
      { label: "Cost", cells: ["Low", "Low"] },
      { label: "Risks", cells: Array(2).fill("Pay cut; Crowded field") },
      { label: "What would have to be true", cells: ["10 h/week", "10 h/week"] },
    ]);
  });
  ```

  ```ts
  // e2e/plan.spec.ts — spec §11 "plan editing"
  import { expect, test } from "@playwright/test";

  test("create a plan and edit it by hand", async ({ page }) => {
    await page.goto("/sign-in");
    await page.getByLabel("Email").fill("ada@example.com");
    await page.getByLabel("Password").fill("a-very-long-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("heading", { name: /^Welcome, / })).toBeVisible();
    await page.getByRole("link", { name: "Plan" }).click();
    await expect(page.getByText("You don't have a plan yet.")).toBeVisible();
    await expect(page.getByText("No career paths yet. Ask your coach to suggest some.")).toBeVisible();

    await page.getByLabel("North star").fill("Move into data analysis within a year");
    await page.getByRole("button", { name: "Create plan" }).click();
    await expect(page.getByRole("heading", { name: "Milestones" })).toBeVisible();

    await page.getByLabel("New milestone").fill("Finish a SQL course");
    await page.getByLabel("Target date").fill("2027-03-31");
    await page.getByRole("button", { name: "Add milestone" }).click();
    await expect(page.getByRole("listitem").filter({ hasText: "Finish a SQL course" })).toContainText("31 Mar 2027");

    await page.getByLabel("New action").fill("Complete 5 SQL exercises");
    await page.getByLabel("Milestone (optional)").selectOption({ label: "Finish a SQL course" });
    await page.getByRole("button", { name: "Add action" }).click();
    const thisWeek = page.getByRole("region", { name: "This week" });
    const done = thisWeek.getByRole("checkbox", { name: "Done: Complete 5 SQL exercises" });
    await done.check();
    await page.reload();
    await expect(done).toBeChecked();

    await page.getByRole("button", { name: "Edit north star" }).click();
    await page.getByLabel("North star").fill("Become a data analyst by next autumn");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Become a data analyst by next autumn")).toBeVisible();

    await page.getByLabel("Status of Finish a SQL course").selectOption("done");
    await expect(page.getByLabel("Status of Finish a SQL course")).toHaveValue("done");

    const action = thisWeek.getByRole("listitem").filter({ hasText: "Complete 5 SQL exercises" });
    await action.getByRole("button", { name: "Remove" }).click();
    await action.getByRole("button", { name: "Yes, delete" }).click();
    await expect(page.getByText("Complete 5 SQL exercises")).toHaveCount(0);
  });
  ```

- [ ] **Step 2: Run tests to verify they fail**

  Run: `pnpm test apps/web && pnpm e2e e2e/plan.spec.ts`
  Expected: FAIL. `./compare` is missing; there is no Plan link.

- [ ] **Step 3: Implement**

  - The page resolves `tz = effectiveTimezone(await getUserSettings(db, userId))` and `thisWeek = mondayOf(new Date(), tz)`, and passes both to the client sections.
  - `comparisonRows`:
    - Route = step titles joined with ` → `, with ` (bridge role)` after bridge steps.
    - Skill gaps = gap names joined with `, `.
    - Time = `min–max months`, or `n months` when min = max.
    - Risks and must-be-true items joined with `; `.
  - `PathComparison` (client) holds the ticked ids in state and renders the table with `comparisonRows` only when 2 or more are ticked.
  - The status checkbox calls `setActionStatusAction` inside `startTransition`. A `ConflictError` (the action changed in another tab) shows `CONFLICT_MESSAGE` in an `Alert` above the list.

- [ ] **Step 4: Run tests**

  Run: `pnpm test && pnpm test:int && pnpm lint && pnpm typecheck && pnpm e2e && bash scripts/compose-smoke.sh`
  Expected: all PASS (auth, admin, profile, stories, and plan specs), `SMOKE OK`.

- [ ] **Step 5: Commit**

  ```bash
  git add -A
  git commit -m "feat: add Plan screen with milestones, weekly actions, and path comparison"
  ```
