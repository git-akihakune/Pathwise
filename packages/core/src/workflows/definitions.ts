import { checkinWorkflow } from "./checkin";
import { onboardingWorkflow } from "./onboarding";
import type { WorkflowDefinition, WorkflowType } from "./types";

export const WORKFLOW_DEFINITIONS: Partial<Record<WorkflowType, WorkflowDefinition>> = {
  onboarding: onboardingWorkflow,
  checkin: checkinWorkflow,
};
