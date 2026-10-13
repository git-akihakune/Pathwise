import { onboardingWorkflow } from "./onboarding";
import type { WorkflowDefinition, WorkflowType } from "./types";

/** The check-in definition is added by Task 6. */
export const WORKFLOW_DEFINITIONS: Partial<Record<WorkflowType, WorkflowDefinition>> = {
  onboarding: onboardingWorkflow,
};
