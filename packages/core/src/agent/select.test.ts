import { expect, it } from "vitest";
import { mergeSkillTools, type SkillContext, type SkillId } from "./registry";
import { selectSkills } from "./select";

it("always includes core, in canonical order", () =>
  expect(selectSkills({ classified: ["planning", "direction"], recent: [] })).toEqual([
    "core",
    "direction",
    "planning",
  ]));
it("keeps skills from the previous 3 turns only", () => {
  expect(
    selectSkills({ classified: [], recent: [["core", "direction"], ["core"], ["core"]] }),
  ).toEqual(["core", "direction"]);
  expect(
    selectSkills({ classified: [], recent: [["core", "direction"], ["core"], ["core"], ["core"]] }),
  ).toEqual(["core"]);
});
it("adds skills implied by the screen", () => {
  expect(selectSkills({ classified: [], recent: [], screen: "plan" })).toEqual([
    "core",
    "planning",
  ]);
  expect(selectSkills({ classified: [], recent: [], screen: "profile" })).toEqual(["core"]);
});
it("uses only core plus the step's skills inside a workflow", () =>
  expect(
    selectSkills({
      classified: ["direction"],
      recent: [["core", "planning"]],
      workflow: { runId: "r", stepId: "s", skills: ["intake"], goal: "g" },
    }),
  ).toEqual(["core", "intake"]));
it("never carries workflow-only skills into free chat", () =>
  expect(selectSkills({ classified: [], recent: [["core", "checkin"]] })).toEqual(["core"]));
it("merges tools in selected order, later skills winning on name clashes (Plan 5's replan step relies on this)", () => {
  const skill = (id: SkillId) => ({
    id,
    description: "",
    promptFragment: () => "",
    tools: () => ({
      proposePlanChange: { description: id } as never,
      [`only_${id}`]: {} as never,
    }),
  });
  const merged = mergeSkillTools(
    [skill("core"), skill("planning"), skill("checkin")],
    {} as SkillContext,
  );
  expect(merged.proposePlanChange).toEqual({ description: "checkin" });
  expect(Object.keys(merged).sort()).toEqual([
    "only_checkin",
    "only_core",
    "only_planning",
    "proposePlanChange",
  ]);
});
