import type { CareerPathInput } from "../../packages/core/src/services/paths";

/** A valid career path, shared by the plan and proposals integration tests. */
export const PATH: CareerPathInput = {
  title: "Data analyst",
  occupationCodes: ["15-2051.00"],
  rationale: "Likes numbers.",
  route: [
    { title: "Reporting analyst", kind: "role", detail: "Internal move", isBridgeRole: true },
  ],
  skillGaps: [{ skill: "SQL", taxonomySkillId: null, importance: 0.8, note: "" }],
  feasibility: {
    timeMonths: { min: 6, max: 12 },
    cost: "Low",
    risks: ["Junior pay"],
    mustBeTrue: ["10 h/week"],
  },
};
