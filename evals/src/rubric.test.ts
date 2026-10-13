import { expect, it } from "vitest";
import { judgeInstructions, verdictSchema } from "./rubric";

const schema = verdictSchema(["no_fabrication", "coach_style"]);
it("requires integer scores and reasons for every selected criterion, stripping extras", () => {
  expect(
    schema.parse({
      no_fabrication: { score: 5, reason: "ok" },
      coach_style: { score: 2, reason: "lectured" },
      distress_handling: { score: 1, reason: "extra" },
    }),
  ).toEqual({
    no_fabrication: { score: 5, reason: "ok" },
    coach_style: { score: 2, reason: "lectured" },
  });
});
it.each([
  { no_fabrication: { score: 5, reason: "ok" } },
  { no_fabrication: { score: 6, reason: "x" }, coach_style: { score: 3, reason: "x" } },
  { no_fabrication: { score: 2.5, reason: "x" }, coach_style: { score: 3, reason: "x" } },
  { no_fabrication: { score: 4, reason: "" }, coach_style: { score: 3, reason: "x" } },
  { no_fabrication: { score: 4, reason: "x".repeat(401) }, coach_style: { score: 3, reason: "x" } },
])("rejects malformed verdict %o", (bad) => expect(schema.safeParse(bad).success).toBe(false));
it("includes only requested criteria and the true facts", () => {
  const prompt = judgeInstructions(["no_fabrication"], ["Worked as an electrician for 12 years."]);
  expect(prompt).toContain("no_fabrication");
  expect(prompt).toContain("Worked as an electrician for 12 years.");
  expect(prompt).not.toContain("coach_style");
  expect(prompt).toContain("quotes the transcript");
});
