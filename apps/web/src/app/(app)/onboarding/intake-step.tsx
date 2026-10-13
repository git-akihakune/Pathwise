import type { CoachUIMessage } from "@pathwise/core/services/sessions";
import { WorkflowChat } from "@/components/workflow-chat";
import { skipStepAction } from "./actions";

export function IntakeStep({
  runId,
  stepId,
  messages,
}: {
  runId: string;
  stepId: string;
  messages: CoachUIMessage[];
}) {
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-xl font-semibold">Get to know you</h2>
      <WorkflowChat
        runId={runId}
        stepId={stepId}
        initialMessages={messages}
        moveOn={skipStepAction.bind(null, runId, stepId)}
      />
    </div>
  );
}
