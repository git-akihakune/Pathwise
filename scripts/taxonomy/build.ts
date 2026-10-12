import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { parseArgs } from "node:util";
import { unzipSync } from "fflate";
import {
  type OccupationRecord,
  type OccupationSkillRecord,
  type RelationRecord,
  type SkillRecord,
  type SnapshotSources,
  writeSnapshot,
} from "../../packages/core/src/taxonomy/snapshot";
import { crosswalkRelations } from "./crosswalk";
import { escoOccupationSkills, escoOccupations, escoSkills } from "./esco";
import { onetOccupationSkills, onetOccupations, onetRelations, onetSkills } from "./onet";

const ONET = {
  version: "31.0",
  url: "https://www.onetcenter.org/dl_files/database/db_31_0_text.zip",
  sha256: "6883548adf5fde64cf6f801b35d15519c9225f2732c3cab0e281c652d16b23a9",
};
const ESCO_VERSION = "1.2.1";
const NEEDED = [
  "Occupation Data",
  "Sample of Reported Titles",
  "Job Titles",
  "Task Statements",
  "Task Ratings",
  "Essential Skills",
  "Transferable Skills",
  "Knowledge",
  "Related Occupations",
  "Content Model Reference",
];

const sha256 = (buf: Uint8Array) => createHash("sha256").update(buf).digest("hex");
const byKey = <T>(rows: T[], key: (r: T) => string) =>
  rows.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));

async function main() {
  const { values } = parseArgs({
    options: {
      esco: { type: "string" },
      crosswalk: { type: "string" },
      "onet-zip": { type: "string" },
      out: { type: "string", default: "data/taxonomy" },
    },
  });

  const zip =
    values["onet-zip"] !== undefined
      ? new Uint8Array(readFileSync(values["onet-zip"]))
      : new Uint8Array(await (await fetch(ONET.url)).arrayBuffer());
  if (sha256(zip) !== ONET.sha256) {
    console.error(
      "O*NET archive checksum mismatch: update ONET in scripts/taxonomy/build.ts deliberately, never by default.",
    );
    process.exit(1);
  }
  const wanted = new Set(NEEDED.map((n) => `db_31_0_text/${n}.txt`));
  const entries = unzipSync(zip, { filter: (f) => wanted.has(f.name) });
  const text = (name: string) => {
    const e = entries[`db_31_0_text/${name}.txt`];
    if (!e) throw new Error(`O*NET archive is missing ${name}.txt`);
    return new TextDecoder().decode(e);
  };

  const ratingFiles = [text("Essential Skills"), text("Transferable Skills"), text("Knowledge")];
  let occupations: OccupationRecord[] = onetOccupations({
    occupationData: text("Occupation Data"),
    reportedTitles: text("Sample of Reported Titles"),
    jobTitles: text("Job Titles"),
    taskStatements: text("Task Statements"),
    taskRatings: text("Task Ratings"),
  });
  const onetIds = new Set(occupations.map((o) => o.id));
  let skills: SkillRecord[] = onetSkills(text("Content Model Reference"), ratingFiles);
  let occupationSkills: OccupationSkillRecord[] = onetOccupationSkills(ratingFiles, onetIds);
  let relations: RelationRecord[] = onetRelations(text("Related Occupations"), onetIds);

  const sources: SnapshotSources = { onet: ONET, esco: null, crosswalk: null };
  if (values.esco) {
    const read = (f: string) => readFileSync(join(values.esco as string, f), "utf8");
    const escoOccs = escoOccupations(read("occupations_en.csv"));
    const escoSk = escoSkills(read("skills_en.csv"));
    occupations = [...occupations, ...escoOccs];
    skills = [...skills, ...escoSk];
    occupationSkills = [
      ...occupationSkills,
      ...escoOccupationSkills(
        read("occupationSkillRelations_en.csv"),
        new Set(escoOccs.map((o) => o.id)),
        new Set(escoSk.map((s) => s.id)),
      ),
    ];
    sources.esco = { version: ESCO_VERSION };
  } else {
    console.warn("Warning: no --esco directory given; the snapshot is O*NET-only.");
  }
  if (values.crosswalk) {
    const buf = readFileSync(values.crosswalk);
    relations = [
      ...relations,
      ...crosswalkRelations(buf.toString("utf8"), new Set(occupations.map((o) => o.id))),
    ];
    sources.crosswalk = { file: basename(values.crosswalk), sha256: sha256(buf) };
  }

  const manifest = await writeSnapshot(
    values.out as string,
    {
      occupations: byKey(occupations, (o) => o.id),
      skills: byKey(skills, (s) => s.id),
      occupationSkills: byKey(occupationSkills, (r) => `${r.occupationId}|${r.skillId}`),
      relations: byKey(relations, (r) => `${r.fromId}|${r.toId}|${r.kind}`),
    },
    sources,
  );
  let bytes = 0;
  console.log(`version: ${manifest.version}`);
  for (const [name, info] of Object.entries(manifest.files)) {
    console.log(`  ${name}: ${info.rows} rows, ${info.bytes} bytes`);
    bytes += info.bytes;
  }
  console.log(`total: ${(bytes / (1024 * 1024)).toFixed(2)} MB gzipped`);
}

await main();
