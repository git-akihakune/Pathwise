import type { CareerPath } from "@pathwise/core/services/paths";
import { expect, it } from "vitest";
import { comparisonRows } from "./compare";

const path = (title: string, min: number, max: number): CareerPath => ({
  id: title,
  title,
  status: "explored",
  version: 1,
  createdAt: new Date(),
  occupationCodes: [],
  rationale: `${title} fits`,
  route: [
    { title: "Reporting analyst", kind: "role", detail: "", isBridgeRole: true },
    { title: "SQL course", kind: "learning", detail: "", isBridgeRole: false },
  ],
  skillGaps: [
    { skill: "SQL", taxonomySkillId: null, importance: 0.8, note: "" },
    { skill: "Statistics", taxonomySkillId: null, importance: 0.6, note: "" },
  ],
  feasibility: {
    timeMonths: { min, max },
    cost: "Low",
    risks: ["Pay cut", "Crowded field"],
    mustBeTrue: ["10 h/week"],
  },
});

it("builds the side-by-side rows", () => {
  expect(comparisonRows([path("Analyst", 6, 12), path("Engineer", 12, 12)])).toEqual([
    { label: "Why it fits", cells: ["Analyst fits", "Engineer fits"] },
    { label: "Route", cells: Array(2).fill("Reporting analyst (bridge role) → SQL course") },
    { label: "Skill gaps", cells: Array(2).fill("SQL, Statistics") },
    { label: "Time", cells: ["6–12 months", "12 months"] },
    { label: "Cost", cells: ["Low", "Low"] },
    { label: "Risks", cells: Array(2).fill("Pay cut; Crowded field") },
    { label: "What would have to be true", cells: ["10 h/week", "10 h/week"] },
  ]);
});
