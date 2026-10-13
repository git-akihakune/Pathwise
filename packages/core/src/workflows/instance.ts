import { WORKFLOW_DEFINITIONS } from "./definitions";
import { createWorkflowEngine } from "./engine";

/** The engine over the shipped definitions. A module of its own so onboarding-actions can use it without a cycle. */
const engine = createWorkflowEngine(WORKFLOW_DEFINITIONS);
export const {
  startWorkflow,
  getActiveRun,
  getRun,
  latestRun,
  advance,
  retryStep,
  abandonRun,
  runWorkflowTurn,
  checkStepCompletion,
  stepMessages,
} = engine;
