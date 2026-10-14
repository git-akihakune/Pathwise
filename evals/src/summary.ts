import { CRITERIA } from "./rubric";
import type { CaseResult, CriterionId, Summary } from "./types";
export const round = (n: number) => Math.round(n * 100) / 100;
export function summarize(cases: CaseResult[]): Summary {
  const summary: Summary = { byCriterion: {}, overall: null, lowScores: [], errors: 0 };
  const all: number[] = [];
  for (const c of cases) if (c.error !== undefined) summary.errors++;
  for (const criterion of Object.keys(CRITERIA) as CriterionId[]) {
    const values: number[] = [];
    for (const c of cases) {
      const s = c.scores[criterion];
      if (c.error !== undefined || !s) continue;
      values.push(s.score);
      all.push(s.score);
      if (s.score <= 2)
        summary.lowScores.push({ persona: c.persona, scenario: c.scenario, criterion, ...s });
    }
    if (values.length)
      summary.byCriterion[criterion] = {
        mean: round(values.reduce((a, b) => a + b, 0) / values.length),
        n: values.length,
      };
  }
  if (all.length) summary.overall = round(all.reduce((a, b) => a + b, 0) / all.length);
  return summary;
}
