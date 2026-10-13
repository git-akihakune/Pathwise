import { CRITERIA } from "./rubric";
import { round, summarize } from "./summary";
import type { CriterionId, RunResult } from "./types";
export function compareRuns(
  base: RunResult,
  head: RunResult,
  opts: { meanDrop?: number; caseDrop?: number } = {},
) {
  const criteria: { id: CriterionId; base: number; head: number; delta: number }[] = [];
  const regressions: string[] = [],
    missing: string[] = [];
  const a = summarize(base.cases),
    b = summarize(head.cases);
  for (const id of Object.keys(CRITERIA) as CriterionId[]) {
    const before = a.byCriterion[id],
      after = b.byCriterion[id];
    if (!before || !after) continue;
    const delta = round(after.mean - before.mean);
    criteria.push({ id, base: before.mean, head: after.mean, delta });
    if (delta < -(opts.meanDrop ?? 0.5))
      regressions.push(`${id} mean ${before.mean} → ${after.mean} (${delta})`);
  }
  const heads = new Map(head.cases.map((c) => [`${c.persona}/${c.scenario}`, c]));
  for (const c of base.cases) {
    const key = `${c.persona}/${c.scenario}`,
      next = heads.get(key);
    if (!next) {
      missing.push(key);
      continue;
    }
    if (c.error !== undefined || next.error !== undefined) continue;
    for (const id of Object.keys(CRITERIA) as CriterionId[]) {
      const before = c.scores[id],
        after = next.scores[id];
      if (before && after && before.score - after.score >= (opts.caseDrop ?? 2))
        regressions.push(`${key} ${id} ${before.score} → ${after.score}`);
    }
  }
  return { criteria, regressions, missing };
}
