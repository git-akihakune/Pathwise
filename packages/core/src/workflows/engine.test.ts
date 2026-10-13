import { expect, it } from "vitest";
import { z } from "zod";
import { resolveNextStep } from "./engine";
import type { WorkflowDefinition } from "./types";

const ui = (id: string, skipWhen?: (s: Record<string, unknown>) => boolean) =>
  ({ kind: "ui", id, input: z.object({}), skipWhen }) as const;
const def: WorkflowDefinition = {
  type: "onboarding",
  steps: [ui("a"), ui("b", (s) => s.skipB === true), ui("c")],
};

it("walks the steps in order, recording skipWhen skips", () => {
  expect(resolveNextStep(def, null, {})).toEqual({ stepId: "a", skipped: [] });
  expect(resolveNextStep(def, "a", {})).toEqual({ stepId: "b", skipped: [] });
  expect(resolveNextStep(def, "a", { skipB: true })).toEqual({ stepId: "c", skipped: ["b"] });
  expect(resolveNextStep(def, "c", {})).toEqual({ stepId: null, skipped: [] });
  expect(() => resolveNextStep(def, "zzz", {})).toThrow(/unknown step/);
});
