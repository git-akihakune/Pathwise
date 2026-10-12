import type {
  LanguageModelV4CallOptions,
  LanguageModelV4Content,
  LanguageModelV4FinishReason,
  LanguageModelV4StreamPart,
} from "@ai-sdk/provider";
import { MockLanguageModelV4, simulateReadableStream } from "ai/test";
import { estimateTokens } from "../tokens";
import type { LlmPurpose } from "../types";
import "./fixtures";
import { lookupMockFixture, type MockCall, type MockReply } from "./registry";

const DEFAULT_TEXT = "Mock reply.";

function buildCall(
  options: LanguageModelV4CallOptions,
  role: "main" | "fast",
  purpose: LlmPurpose,
): MockCall {
  const users = options.prompt.filter((m) => m.role === "user");
  const last = users[users.length - 1];
  return {
    purpose,
    role,
    lastUserText: last?.content.map((p) => (p.type === "text" ? p.text : "")).join("") ?? "",
    system: options.prompt.flatMap((m) => (m.role === "system" ? [m.content] : [])).join("\n"),
    toolNames: (options.tools ?? []).map((t) => t.name),
  };
}

function promptText(options: LanguageModelV4CallOptions): string {
  return options.prompt
    .map((m) =>
      typeof m.content === "string"
        ? m.content
        : m.content.map((p) => (p.type === "text" ? p.text : "")).join(""),
    )
    .join("\n");
}

interface Built {
  content: LanguageModelV4Content[];
  text: string;
  finishReason: LanguageModelV4FinishReason;
}

function build(reply: MockReply, afterToolResult: boolean): Built {
  const stop = { unified: "stop", raw: "stop" } as const;
  if (afterToolResult) {
    const text = "text" in reply && typeof reply.text === "string" ? reply.text : DEFAULT_TEXT;
    return { content: [{ type: "text", text }], text, finishReason: stop };
  }
  if ("toolCalls" in reply) {
    return {
      content: reply.toolCalls.map((c, i) => ({
        type: "tool-call" as const,
        toolCallId: `mock-call-${i}`,
        toolName: c.toolName,
        input: JSON.stringify(c.input),
      })),
      text: "",
      finishReason: { unified: "tool-calls", raw: "tool_calls" },
    };
  }
  const text = "json" in reply ? JSON.stringify(reply.json) : reply.text;
  return { content: [{ type: "text", text }], text, finishReason: stop };
}

function splitText(text: string): string[] {
  const pieces = text.split(/(?<= )/).filter((p) => p.length > 0);
  if (pieces.length >= 2) return pieces;
  const mid = Math.ceil(text.length / 2);
  return [text.slice(0, mid), text.slice(mid)].filter((p) => p.length > 0);
}

export function createMockModel(role: "main" | "fast", purpose: LlmPurpose) {
  const run = (options: LanguageModelV4CallOptions) => {
    const reply = lookupMockFixture(purpose)(buildCall(options, role, purpose));
    const afterToolResult = options.prompt[options.prompt.length - 1]?.role === "tool";
    const built = build(reply, afterToolResult);
    const usage = {
      inputTokens: {
        total: estimateTokens(promptText(options)),
        noCache: undefined,
        cacheRead: undefined,
        cacheWrite: undefined,
      },
      outputTokens: {
        total: estimateTokens(built.text),
        text: undefined,
        reasoning: undefined,
      },
    };
    return { ...built, usage };
  };

  return new MockLanguageModelV4({
    provider: "mock",
    modelId: `mock-${role}`,
    doGenerate: async (options) => {
      const { content, finishReason, usage } = run(options);
      return { content, finishReason, usage, warnings: [] };
    },
    doStream: async (options) => {
      const { content, finishReason, usage } = run(options);
      const chunks: LanguageModelV4StreamPart[] = [{ type: "stream-start", warnings: [] }];
      content.forEach((part, i) => {
        if (part.type === "text") {
          const id = `mock-text-${i}`;
          chunks.push({ type: "text-start", id });
          for (const delta of splitText(part.text)) chunks.push({ type: "text-delta", id, delta });
          chunks.push({ type: "text-end", id });
        } else if (part.type === "tool-call") {
          chunks.push(part);
        }
      });
      chunks.push({ type: "finish", finishReason, usage });
      return { stream: simulateReadableStream({ chunks }) };
    },
  });
}
