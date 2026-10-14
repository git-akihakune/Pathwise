import { describe, expect, it } from "vitest";
import {
  type DocumentExtraction,
  extractionBudgetChars,
  normalizeDate,
  normalizeExtraction,
} from "./extraction";

it.each([
  ["2018", "2018"],
  [" 2018-03 ", "2018-03"],
  ["2018-03-15", "2018-03-15"],
  ["2018-13", null],
  ["2018-02-30", null],
  ["present", null],
  ["Current", null],
  ["", null],
  ["spring 2019", null],
  [null, null],
])("normalizeDate(%o) → %o", (input, expected) => expect(normalizeDate(input)).toBe(expected));

it("budgets document text to the model's context window", () => {
  expect(extractionBudgetChars(8192)).toBe(13_660);
  expect(extractionBudgetChars(2048)).toBe(8_000);
  expect(extractionBudgetChars(200_000)).toBe(122_000);
});

describe("normalizeExtraction", () => {
  const empty = { experiences: [], education: [], skills: [], memories: [], stories: [] };
  const exp = (o: object) => ({
    title: "T",
    organization: null,
    startDate: null,
    endDate: null,
    description: null,
    highlights: [],
    ...o,
  });

  it("drops impossible dates and end dates before the start", () => {
    const out = normalizeExtraction(
      {
        ...empty,
        experiences: [
          exp({ startDate: "2018-02-30", endDate: "2019" }),
          exp({ startDate: "2020-05", endDate: "2019" }),
        ],
      },
      false,
    );
    expect(out.experiences[0]).toMatchObject({ startDate: null, endDate: "2019" });
    expect(out.experiences[1]).toMatchObject({ startDate: "2020-05", endDate: null });
  });

  it("clamps over-long fields and slices long lists instead of failing", () => {
    const out: DocumentExtraction = normalizeExtraction(
      {
        ...empty,
        experiences: Array.from({ length: 40 }, () =>
          exp({
            title: "x".repeat(500),
            description: "d".repeat(9000),
            highlights: Array(30).fill("h".repeat(5000)),
          }),
        ),
        memories: [
          { category: "bogus", content: "m", sensitive: false },
          { category: "value", content: "m".repeat(2000), sensitive: null },
        ],
        skills: [{ name: "Go", level: "godlike", evidence: null }],
      },
      true,
    );
    expect(out.experiences).toHaveLength(30);
    expect(out.experiences[0]?.title).toHaveLength(200);
    expect(out.experiences[0]?.description).toHaveLength(4000);
    expect(out.experiences[0]?.highlights).toHaveLength(20);
    expect(out.experiences[0]?.highlights[0]).toHaveLength(4000);
    expect(out.memories).toHaveLength(1);
    expect(out.memories[0]).toMatchObject({ category: "value", sensitive: false });
    expect(out.memories[0]?.content).toHaveLength(1000);
    expect(out.skills[0]?.level).toBeNull();
    expect(out.truncated).toBe(true);
  });
});
