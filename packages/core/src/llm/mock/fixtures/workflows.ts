import { type MockCall, type MockReply, registerMockFixture } from "../registry";

// Mock-mode replies for workflows (LLM_MODE=mock, E2E).

export const workflowCompleteFixture = (call: MockCall): MockReply => ({
  json: { done: /that's all/i.test(call.lastUserText), reason: "mock" },
});

registerMockFixture("workflow.complete", workflowCompleteFixture);

export const MOCK_EXTRACTION = {
  experiences: [
    {
      title: "Staff Nurse",
      organization: "City Hospital",
      startDate: "2018-03",
      endDate: "present",
      description: "Ward nurse on a busy surgical unit.",
      highlights: ["Trained 12 new nurses"],
    },
  ],
  education: [
    {
      institution: "University of Leeds",
      qualification: "BSc",
      field: "Nursing",
      startDate: "2014",
      endDate: "2017",
    },
  ],
  skills: [
    { name: "Patient care", level: "expert", evidence: null },
    { name: "Team leadership", level: "working", evidence: "Trained 12 new nurses" },
  ],
  memories: [
    {
      category: "aspiration",
      content: "Wants to move into healthcare data work",
      sensitive: false,
    },
  ],
  stories: [],
};

registerMockFixture("extract.document", () => ({ json: MOCK_EXTRACTION }));

registerMockFixture("onboarding.snapshot", () => ({
  text: "Here's what I heard: you're an experienced nurse who values autonomy and wants to move toward healthcare data.",
}));
