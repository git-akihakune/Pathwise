import { expect, it } from "vitest";
import { isProposalTool, toolLabel } from "./tool-labels";

it.each([
  [
    {
      type: "tool-getOccupation",
      state: "output-available",
      input: { idOrCode: "29-1141.00" },
      output: { title: "Registered Nurses", source: "onet", code: "29-1141.00" },
    },
    "Looked up: Registered Nurses (O*NET 29-1141.00)",
  ],
  [
    {
      type: "tool-getOccupation",
      state: "output-available",
      input: {},
      output: { title: "Nurse", source: "esco", code: "2221.1" },
    },
    "Looked up: Nurse (ESCO 2221.1)",
  ],
  [
    { type: "tool-getOccupation", state: "input-available", input: { idOrCode: "29-1141.00" } },
    "Looking up 29-1141.00…",
  ],
  [
    {
      type: "tool-getOccupation",
      state: "output-error",
      input: {},
      errorText: "No occupation matches “x”.",
    },
    "Lookup failed: No occupation matches “x”.",
  ],
  [
    {
      type: "tool-searchOccupations",
      state: "output-available",
      input: { query: "nurse" },
      output: { results: [] },
    },
    "Searched occupations: “nurse”",
  ],
  [
    {
      type: "tool-searchMemory",
      state: "output-available",
      input: { query: "x" },
      output: { results: [] },
    },
    "Checked my notes",
  ],
  [
    { type: "tool-getPlan", state: "output-available", input: {}, output: { plan: null } },
    "Looked at your plan",
  ],
  [
    { type: "tool-generateCareerPaths", state: "input-available", input: {} },
    "Drafting career paths…",
  ],
])("%o → %s", (part, label) => expect(toolLabel(part as never)).toBe(label));
it("recognizes proposal tools", () => {
  expect(isProposalTool("proposePlanChange")).toBe(true);
  expect(isProposalTool("getPlan")).toBe(false);
});
