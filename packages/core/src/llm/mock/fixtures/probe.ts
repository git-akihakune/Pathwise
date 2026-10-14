import { type MockCall, type MockReply, registerMockFixture } from "../registry";

/** Mirrors the prompts in ../../probe.ts. */
export const probeFixture = (call: MockCall): MockReply => {
  if (call.toolNames.includes("echo")) {
    return { toolCalls: [{ toolName: "echo", input: { value: "pathwise" } }] };
  }
  if (call.lastUserText.includes("city Paris")) {
    return { json: { city: "Paris", population: 2100000 } };
  }
  return { text: "ready 1 2 3 4 5" };
};

registerMockFixture("probe", probeFixture);
