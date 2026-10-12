import { describe, expect, it } from "vitest";
import { importanceFromIm, onetOccupationSkills, onetOccupations, onetRelations } from "./onet";

const tsv = (rows: string[][]) => rows.map((r) => r.join("\t")).join("\r\n");
const HEAD = [
  "O*NET-SOC Code",
  "Element ID",
  "Element Name",
  "Scale ID",
  "Data Value",
  "N",
  "Standard Error",
  "Lower CI Bound",
  "Upper CI Bound",
  "Recommend Suppress",
  "Not Relevant",
  "Date",
  "Domain Source",
];
const r = (
  code: string,
  el: string,
  scale: string,
  v: string,
  suppress = "N",
  notRelevant = "n/a",
) => [
  code,
  el,
  "Name",
  scale,
  v,
  "8",
  "0.1",
  "0",
  "0",
  suppress,
  notRelevant,
  "08/2026",
  "Analyst",
];

it.each([
  [1, 0],
  [5, 1],
  [3.5, 0.63],
  [4.5, 0.88],
])("IM %d → %d", (im, expected) => {
  expect(importanceFromIm(im)).toBe(expected);
});

it("pairs IM importance with LV level, dropping suppressed and not-relevant pairs", () => {
  const file = tsv([
    HEAD,
    r("15-1252.00", "2.B.3.e", "IM", "4.50"),
    r("15-1252.00", "2.B.3.e", "LV", "3.50", "N", "N"),
    r("15-1252.00", "2.B.1.f", "IM", "2.00", "Y"),
    r("15-1252.00", "2.B.1.f", "LV", "1.00", "N", "N"),
    r("29-1141.00", "2.B.3.e", "IM", "1.20"),
    r("29-1141.00", "2.B.3.e", "LV", "0.00", "N", "Y"),
  ]);
  expect(onetOccupationSkills([file])).toEqual([
    { occupationId: "onet:15-1252.00", skillId: "onet:2.B.3.e", importance: 0.88, level: 0.5 },
  ]);
});

it("drops occupation-skill and relation rows for codes missing from Occupation Data", () => {
  const file = tsv([
    HEAD,
    r("15-1252.00", "2.B.3.e", "IM", "4.50"),
    r("99-9999.00", "2.B.3.e", "IM", "4.50"),
  ]);
  const known = new Set(["onet:15-1252.00"]);
  expect(onetOccupationSkills([file], known).map((o) => o.occupationId)).toEqual([
    "onet:15-1252.00",
  ]);
  const rel = tsv([
    ["O*NET-SOC Code", "Related O*NET-SOC Code", "Relatedness Tier", "Index"],
    ["15-1252.00", "15-1251.00", "Primary-Short", "1"],
    ["15-1252.00", "99-9999.00", "Primary-Long", "2"],
    ["15-1252.00", "15-1251.00", "Supplemental", "3"],
  ]);
  expect(onetRelations(rel, new Set(["onet:15-1252.00", "onet:15-1251.00"]))).toEqual([
    { fromId: "onet:15-1252.00", toId: "onet:15-1251.00", kind: "related" },
  ]);
  expect(onetRelations(rel, new Set(["onet:15-1252.00"]))).toEqual([]);
});

describe("onetOccupations", () => {
  const ids = Array.from({ length: 12 }, (_, i) => String(i + 1));
  const occ = onetOccupations({
    occupationData: tsv([
      ["O*NET-SOC Code", "Title", "Description"],
      ["15-1252.00", "Software Developers", "Develop software."],
    ]),
    reportedTitles: tsv([
      ["O*NET-SOC Code", "Reported Job Title", "Shown in My Next Move"],
      ["15-1252.00", "Software Engineer", "Y"],
      ["15-1252.00", "Software Developers", "N"],
    ]),
    jobTitles: tsv([
      ["O*NET-SOC Code", "Job Title", "Short Title", "Source(s)"],
      ["15-1252.00", "software engineer", "n/a", "08"],
      ["15-1252.00", "Application Developer", "n/a", "08"],
    ]),
    taskStatements: tsv([
      [
        "O*NET-SOC Code",
        "Task ID",
        "Task",
        "Task Type",
        "Incumbents Responding",
        "Date",
        "Domain Source",
      ],
      ...ids.map((id) => ["15-1252.00", id, `Task ${id}`, "Core", "10", "08/2026", "Incumbent"]),
    ]),
    taskRatings: tsv([
      ["O*NET-SOC Code", "Task ID", "Scale ID", "Category", "Data Value"],
      ...ids.map((id) => ["15-1252.00", id, "IM", "n/a", String(Number(id) / 3)]),
      ["15-1252.00", "1", "RT", "n/a", "99"],
    ]),
  });
  it("dedupes alternate titles case-insensitively and drops the title itself", () => {
    expect(occ[0]).toMatchObject({
      id: "onet:15-1252.00",
      source: "onet",
      code: "15-1252.00",
      title: "Software Developers",
      altTitles: ["Software Engineer", "Application Developer"],
    });
  });
  it("keeps the 10 most important tasks (IM scale only)", () => {
    expect(occ[0]?.tasks).toEqual(Array.from({ length: 10 }, (_, i) => `Task ${12 - i}`));
  });
});
