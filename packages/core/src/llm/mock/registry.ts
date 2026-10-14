import type { LlmPurpose } from "../types";

export interface MockCall {
  purpose: LlmPurpose;
  role: "main" | "fast";
  lastUserText: string;
  system: string;
  toolNames: string[];
}
export type MockReply =
  | { text: string }
  | { json: unknown }
  | { toolCalls: { toolName: string; input: unknown }[]; text?: string };
export type MockFixture = (call: MockCall) => MockReply;

const fixtures = new Map<string, MockFixture>();

export function registerMockFixture(purpose: LlmPurpose | "*", fixture: MockFixture): void {
  fixtures.set(purpose, fixture);
}

export function lookupMockFixture(purpose: LlmPurpose): MockFixture {
  return fixtures.get(purpose) ?? fixtures.get("*") ?? (() => ({ text: "Mock reply." }));
}
