import type { RelationRecord } from "../../packages/core/src/taxonomy/snapshot";
import { escoUuid, parseCsv } from "./esco";

const ESCO_URI = /^http:\/\/data\.europa\.eu\/esco\/occupation\//;
const ONET_CODE = /^\d{2}-\d{4}\.\d{2}$/;

export function crosswalkRelations(csv: string, knownIds: Set<string>): RelationRecord[] {
  const rows = parseCsv(csv);
  const columns = Object.keys(rows[0] ?? {});
  const escoCol = columns.find((c) => rows.some((r) => ESCO_URI.test(r[c] ?? "")));
  const onetCol = columns.find((c) => rows.some((r) => ONET_CODE.test(r[c] ?? "")));
  if (!escoCol || !onetCol) throw new Error("Crosswalk CSV: could not find ESCO and O*NET columns");
  const seen = new Set<string>();
  const out: RelationRecord[] = [];
  const add = (fromId: string, toId: string) => {
    const key = `${fromId}|${toId}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ fromId, toId, kind: "crosswalk" });
  };
  for (const r of rows) {
    const uri = r[escoCol] ?? "";
    const code = r[onetCol] ?? "";
    if (!ESCO_URI.test(uri) || !ONET_CODE.test(code)) continue;
    const esco = `esco:${escoUuid(uri)}`;
    const onet = `onet:${code}`;
    if (!knownIds.has(esco) || !knownIds.has(onet)) continue;
    add(esco, onet);
    add(onet, esco);
  }
  return out;
}
