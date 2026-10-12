import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { FIXTURE } from "../../../../test/fixtures/taxonomy/records";
import { getTestDb, resetDb, TAXONOMY_FIXTURE_DIR } from "../../../../test/integration/db";
import { ConfigError } from "../errors";
import {
  getOccupation,
  importTaxonomySnapshot,
  matchTaxonomySkill,
  searchOccupations,
  searchTaxonomySkills,
  writeSnapshot,
} from ".";

const db = getTestDb();
const NONE = { onet: null, esco: null, crosswalk: null };
const tmp = () => mkdtempSync(join(tmpdir(), "tax-"));
const versionOf = (dir: string) =>
  JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")).version;
const count = async (t: string) =>
  (await db.execute<{ n: number }>(sql.raw(`select count(*)::int as n from ${t}`))).rows[0]?.n;

beforeEach(() => resetDb(db));

describe("importTaxonomySnapshot", () => {
  it("imports once and records the version", async () => {
    const version = versionOf(TAXONOMY_FIXTURE_DIR);
    expect(await importTaxonomySnapshot(db, TAXONOMY_FIXTURE_DIR)).toEqual({
      imported: true,
      version,
    });
    expect([
      await count("occupations"),
      await count("taxonomy_skills"),
      await count("occupation_skills"),
      await count("occupation_relations"),
    ]).toEqual([5, 8, 13, 4]);
    expect(await importTaxonomySnapshot(db, TAXONOMY_FIXTURE_DIR)).toEqual({
      imported: false,
      version,
    });
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
    await writeSnapshot(
      broken,
      {
        ...FIXTURE,
        occupationSkills: [
          ...FIXTURE.occupationSkills,
          { occupationId: "onet:15-1252.00", skillId: "onet:9.Z.9", importance: 0.9, level: null },
        ],
      },
      NONE,
    );
    await expect(importTaxonomySnapshot(db, broken)).rejects.toThrow();
    expect(await count("occupation_skills")).toBe(13);
    expect((await db.execute(sql`select version from taxonomy_meta`)).rows).toEqual([
      { version: versionOf(TAXONOMY_FIXTURE_DIR) },
    ]);
    const v2 = tmp();
    await writeSnapshot(
      v2,
      {
        ...FIXTURE,
        occupations: FIXTURE.occupations.map((o) =>
          o.id === "onet:29-1141.00" ? { ...o, title: "Registered Nurses (RN)" } : o,
        ),
      },
      NONE,
    );
    expect((await importTaxonomySnapshot(db, v2)).imported).toBe(true);
    expect((await getOccupation(db, "29-1141.00"))?.title).toBe("Registered Nurses (RN)");
    expect(await count("occupations")).toBe(5);
  });
});

describe("queries", () => {
  beforeEach(async () => {
    await importTaxonomySnapshot(db, TAXONOMY_FIXTURE_DIR);
  });
  it("matches alternate titles and filters by source", async () => {
    expect((await searchOccupations(db, "software engineer")).map((o) => o.id).sort()).toEqual([
      "esco:occ-software-developer",
      "onet:15-1252.00",
    ]);
    expect(
      (await searchOccupations(db, "software engineer", { source: "onet" })).map((o) => o.id),
    ).toEqual(["onet:15-1252.00"]);
  });
  it("ranks title matches above description matches", async () => {
    expect((await searchOccupations(db, "medical")).map((o) => o.id)).toEqual([
      "onet:11-9111.00",
      "onet:29-1141.00",
    ]);
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
    expect(occ?.skills.map((s) => [s.name, s.importance])).toEqual([
      ["Programming", 0.94],
      ["Computers and Electronics", 0.88],
      ["Critical Thinking", 0.72],
      ["Mathematics", 0.55],
      ["Service Orientation", 0.31],
    ]);
    expect(occ?.related.map((r) => r.id).sort()).toEqual([
      "esco:occ-software-developer",
      "onet:15-1253.00",
    ]);
    expect(await getOccupation(db, "99-9999.00")).toBeNull();
  });
  it("searches skills by substring, exact and prefix matches first", async () => {
    expect((await searchTaxonomySkills(db, "Programm")).map((s) => s.name)).toEqual([
      "Programming",
      "Python (computer programming)",
    ]);
  });
  it("matches a skill name exactly, ignoring case and spaces, preferring O*NET then id", async () => {
    expect(await matchTaxonomySkill(db, "  programming ")).toBe("onet:2.B.3.e");
    expect(await matchTaxonomySkill(db, "Mathematics")).toBe("onet:2.A.1.e");
    expect(await matchTaxonomySkill(db, "python")).toBeNull();
  });
});
