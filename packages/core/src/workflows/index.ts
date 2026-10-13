import { WORKFLOW_DEFINITIONS } from "./definitions";

export { WORKFLOW_DEFINITIONS } from "./definitions";
export { createWorkflowEngine, resolveNextStep, type WorkflowEngine } from "./engine";
export * from "./instance";
export * from "./onboarding";
export * from "./onboarding-actions";
export * from "./types";

/** The step of a run's definition, for UI that needs its kind or manual-fallback hint. */
export function getStep(type: keyof typeof WORKFLOW_DEFINITIONS, stepId: string) {
  return WORKFLOW_DEFINITIONS[type]?.steps.find((s) => s.id === stepId);
}

/** The "do it manually" hint of a compute step ("" for other steps). */
export function manualHint(type: keyof typeof WORKFLOW_DEFINITIONS, stepId: string): string {
  const step = getStep(type, stepId);
  return step?.kind === "compute" ? step.manualHint : "";
}
