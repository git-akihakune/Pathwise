import { expect, it } from "vitest";
import { summarize } from "./summary";
import type { CaseResult } from "./types";

const c = (scenario: string, scores: CaseResult["scores"], error?: string): CaseResult => ({
  persona: "p",
  scenario,
  transcript: [],
  proposals: [],
  scores,
  error,
});
it("averages individual scores, excludes errors, and flags scores at most two", () => {
  const s = summarize([
    c("a", {
      no_fabrication: { score: 5, reason: "r" },
      coach_style: { score: 2, reason: "lectured" },
    }),
    c("b", { no_fabrication: { score: 4, reason: "r" } }),
    c("c", { coach_style: { score: 1, reason: "exclude" } }, "timeout"),
  ]);
  expect(s.byCriterion).toEqual({
    no_fabrication: { mean: 4.5, n: 2 },
    coach_style: { mean: 2, n: 1 },
  });
  expect(s.overall).toBe(3.67);
  expect(s.errors).toBe(1);
  expect(s.lowScores).toEqual([
    { persona: "p", scenario: "a", criterion: "coach_style", score: 2, reason: "lectured" },
  ]);
});
it("reports null overall when no valid scores exist", () => {
  expect(summarize([]).overall).toBeNull();
  expect(summarize([c("a", {}, "error")]).overall).toBeNull();
});
