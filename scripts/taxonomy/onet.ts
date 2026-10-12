import type {
  OccupationRecord,
  OccupationSkillRecord,
  RelationRecord,
  SkillRecord,
} from "../../packages/core/src/taxonomy/snapshot";

const round2 = (n: number) => Math.round(n * 100) / 100;
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

export function parseTsv(text: string): Record<string, string>[] {
  const lines = text.split("\n").map((l) => l.replace(/\r$/, ""));
  const header = (lines.shift() ?? "").split("\t");
  const rows: Record<string, string>[] = [];
  for (const line of lines) {
    if (line === "") continue;
    const cells = line.split("\t");
    rows.push(Object.fromEntries(header.map((h, i) => [h, cells[i] ?? ""])));
  }
  return rows;
}

export function importanceFromIm(v: number): number {
  return clamp01(round2((v - 1) / 4));
}

export function dedupeTitles(titles: string[], exclude: string, cap = 30): string[] {
  const seen = new Set([exclude.trim().toLowerCase()]);
  const out: string[] = [];
  for (const raw of titles) {
    const t = raw.trim();
    const key = t.toLowerCase();
    if (t === "" || seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out.slice(0, cap);
}

const group = <T>(rows: T[], key: (r: T) => string) => {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    const list = m.get(k);
    if (list) list.push(r);
    else m.set(k, [r]);
  }
  return m;
};

export function onetOccupations(f: {
  occupationData: string;
  reportedTitles: string;
  jobTitles: string;
  taskStatements: string;
  taskRatings: string;
}): OccupationRecord[] {
  const reported = group(parseTsv(f.reportedTitles), (r) => r["O*NET-SOC Code"] ?? "");
  const jobTitles = group(parseTsv(f.jobTitles), (r) => r["O*NET-SOC Code"] ?? "");
  const statements = group(parseTsv(f.taskStatements), (r) => r["O*NET-SOC Code"] ?? "");
  const importance = new Map<string, number>();
  for (const r of parseTsv(f.taskRatings)) {
    if (r["Scale ID"] === "IM") {
      importance.set(`${r["O*NET-SOC Code"]}|${r["Task ID"]}`, Number(r["Data Value"]));
    }
  }
  return parseTsv(f.occupationData).map((row) => {
    const code = row["O*NET-SOC Code"] ?? "";
    const title = row.Title ?? "";
    const alt = [
      ...(reported.get(code) ?? []).map((r) => r["Reported Job Title"] ?? ""),
      ...(jobTitles.get(code) ?? []).map((r) => r["Job Title"] ?? ""),
    ];
    const tasks = (statements.get(code) ?? [])
      .flatMap((s) => {
        const im = importance.get(`${code}|${s["Task ID"]}`);
        return im === undefined ? [] : [{ id: s["Task ID"] ?? "", im, text: s.Task ?? "" }];
      })
      .sort((a, b) => b.im - a.im || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .slice(0, 10)
      .map((t) => t.text);
    return {
      id: `onet:${code}`,
      source: "onet" as const,
      code,
      title,
      description: row.Description ?? "",
      altTitles: dedupeTitles(alt, title),
      tasks,
    };
  });
}

export function onetSkills(contentModelReference: string, ratingFiles: string[]): SkillRecord[] {
  const descriptions = new Map(
    parseTsv(contentModelReference).map((r) => [r["Element ID"] ?? "", r.Description ?? ""]),
  );
  const skills = new Map<string, SkillRecord>();
  for (const file of ratingFiles) {
    for (const r of parseTsv(file)) {
      const code = r["Element ID"] ?? "";
      if (skills.has(code)) continue;
      skills.set(code, {
        id: `onet:${code}`,
        source: "onet",
        code,
        name: r["Element Name"] ?? "",
        description: descriptions.get(code) ?? "",
      });
    }
  }
  return [...skills.values()];
}

/** `knownOccupationIds`, when given, drops rows for codes missing from Occupation Data. */
export function onetOccupationSkills(
  ratingFiles: string[],
  knownOccupationIds?: Set<string>,
): OccupationSkillRecord[] {
  const out: OccupationSkillRecord[] = [];
  for (const file of ratingFiles) {
    const rows = parseTsv(file);
    const lv = new Map<string, Record<string, string>>();
    for (const r of rows) {
      if (r["Scale ID"] === "LV") lv.set(`${r["O*NET-SOC Code"]}|${r["Element ID"]}`, r);
    }
    for (const r of rows) {
      if (r["Scale ID"] !== "IM" || r["Recommend Suppress"] === "Y") continue;
      const occupationId = `onet:${r["O*NET-SOC Code"]}`;
      if (knownOccupationIds && !knownOccupationIds.has(occupationId)) continue;
      const level = lv.get(`${r["O*NET-SOC Code"]}|${r["Element ID"]}`);
      if (level?.["Not Relevant"] === "Y") continue;
      out.push({
        occupationId,
        skillId: `onet:${r["Element ID"]}`,
        importance: importanceFromIm(Number(r["Data Value"])),
        level: level ? clamp01(round2(Number(level["Data Value"]) / 7)) : null,
      });
    }
  }
  return out;
}

export function onetRelations(
  relatedOccupations: string,
  knownOccupationIds: Set<string>,
): RelationRecord[] {
  const out: RelationRecord[] = [];
  for (const r of parseTsv(relatedOccupations)) {
    const tier = r["Relatedness Tier"];
    if (tier !== "Primary-Short" && tier !== "Primary-Long") continue;
    const fromId = `onet:${r["O*NET-SOC Code"]}`;
    const toId = `onet:${r["Related O*NET-SOC Code"]}`;
    if (!knownOccupationIds.has(fromId) || !knownOccupationIds.has(toId)) continue;
    out.push({ fromId, toId, kind: "related" });
  }
  return out;
}
