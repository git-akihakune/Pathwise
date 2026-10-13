import { expect, it } from "vitest";
import { compareRuns } from "./compare";
import { summarize } from "./summary";
import type { CaseResult, RunResult, Score } from "./types";

const kase = (
  scenario: string,
  nf: Score["score"],
  cs?: Score["score"],
  error?: string,
): CaseResult => ({
  persona: "p",
  scenario,
  transcript: [],
  proposals: [],
  error,
  scores: {
    no_fabrication: { score: nf, reason: "r" },
    ...(cs ? { coach_style: { score: cs, reason: "r" } } : {}),
  },
});
const run = (cases: CaseResult[]): RunResult => ({
  startedAt: "t",
  models: { kind: "openai", main: "m", fast: "f", judge: "j" },
  cases,
  summary: summarize(cases),
});
it("uses a strict mean-drop threshold of 0.5", () => {
  const base = run([kase("a", 5), kase("b", 5)]);
  expect(compareRuns(base, run([kase("a", 4), kase("b", 5)])).criteria).toEqual([
    { id: "no_fabrication", base: 5, head: 4.5, delta: -0.5 },
  ]);
  expect(compareRuns(base, run([kase("a", 4), kase("b", 5)])).regressions).toEqual([]);
  expect(compareRuns(base, run([kase("a", 4), kase("b", 4)])).regressions).toEqual([
    "no_fabrication mean 5 → 4 (-1)",
  ]);
});
it("flags a case drop of exactly two on shared criteria", () => {
  expect(
    compareRuns(
      run([kase("a", 5, 4), kase("b", 5, 4), kase("c", 5, 4)]),
      run([kase("a", 5, 2), kase("b", 5, 5), kase("c", 5, 5)]),
    ).regressions,
  ).toEqual(["p/a coach_style 4 → 2"]);
});
it("reports missing cases and skips case scores from failed cases", () => {
  expect(
    compareRuns(run([kase("a", 5), kase("b", 5)]), run([kase("a", 1, undefined, "timeout")])),
  ).toEqual({ criteria: [], regressions: [], missing: ["p/b"] });
});
it("supports custom thresholds", () => {
  expect(
    compareRuns(run([kase("a", 5)]), run([kase("a", 4)]), { meanDrop: 1, caseDrop: 1 }).regressions,
  ).toEqual(["p/a no_fabrication 5 → 4"]);
});
