import { type MockCall, type MockReply, registerMockFixture } from "../registry";

// Mock-mode replies for workflows (LLM_MODE=mock, E2E).

export const workflowCompleteFixture = (call: MockCall): MockReply => ({
  json: { done: /that's all/i.test(call.lastUserText), reason: "mock" },
});

registerMockFixture("workflow.complete", workflowCompleteFixture);
