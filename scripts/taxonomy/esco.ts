import { parse } from "csv-parse/sync";
import type {
  OccupationRecord,
  OccupationSkillRecord,
  SkillRecord,
} from "../../packages/core/src/taxonomy/snapshot";
import { dedupeTitles } from "./onet";

type Row = Record<string, string>;

export const parseCsv = (csv: string): Row[] =>
  parse(csv, { columns: true, bom: true, skip_empty_lines: true });

export const escoUuid = (uri: string) => uri.slice(uri.lastIndexOf("/") + 1);

const released = (r: Row) => r.status === undefined || r.status === "released";

export function escoOccupations(csv: string): OccupationRecord[] {
  return parseCsv(csv)
    .filter(released)
    .map((r) => {
      const uuid = escoUuid(r.conceptUri ?? "");
      const title = r.preferredLabel ?? "";
      return {
        id: `esco:${uuid}`,
        source: "esco" as const,
        code: r.code || uuid,
        title,
        description: r.description || r.definition || "",
        altTitles: dedupeTitles((r.altLabels ?? "").split("\n"), title),
        tasks: [],
      };
    });
}

export function escoSkills(csv: string): SkillRecord[] {
  return parseCsv(csv)
    .filter(released)
    .map((r) => {
      const uuid = escoUuid(r.conceptUri ?? "");
      return {
        id: `esco:${uuid}`,
        source: "esco" as const,
        code: uuid,
        name: r.preferredLabel ?? "",
        description: r.description || r.definition || "",
      };
    });
}

export function escoOccupationSkills(
  csv: string,
  occupationIds: Set<string>,
  skillIds: Set<string>,
): OccupationSkillRecord[] {
  const out: OccupationSkillRecord[] = [];
  for (const r of parseCsv(csv)) {
    const occupationId = `esco:${escoUuid(r.occupationUri ?? "")}`;
    const skillId = `esco:${escoUuid(r.skillUri ?? "")}`;
    if (!occupationIds.has(occupationId) || !skillIds.has(skillId)) continue;
    out.push({
      occupationId,
      skillId,
      importance: r.relationType === "essential" ? 1 : 0.5,
      level: null,
    });
  }
  return out;
}
