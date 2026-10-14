import type { LanguageModelV4 } from "@ai-sdk/provider";
import { embedMany, generateText, isStepCount, Output, streamText, tool } from "ai";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createEmbeddingModel, createLanguageModel } from "../factory";
import type { ProviderKind } from "../types";
import { createMockEmbeddingModel, createMockModel, type MockCall, registerMockFixture } from ".";

const target = (kind: ProviderKind) => ({
  id: "cfg",
  kind,
  apiKey: "k",
  baseUrl: null,
  contextWindow: null,
  capabilities: null,
  models: { main: "m-main", fast: "m-fast", embedding: "e" },
});

describe("mock language model", () => {
  it("falls back to the default fixture and reports usage", async () => {
    const r = await generateText({ model: createMockModel("fast", "unregistered"), prompt: "hi" });
    expect(r.text).toBe("Mock reply.");
    expect(r.usage.inputTokens).toBeGreaterThan(0);
  });
  it("passes purpose, role, last user text, system and tool names to the fixture", async () => {
    let seen: MockCall | undefined;
    registerMockFixture("t.capture", (c) => {
      seen = c;
      return { text: "ok" };
    });
    await generateText({
      model: createMockModel("main", "t.capture"),
      instructions: "Be kind.",
      messages: [
        { role: "user", content: "first" },
        { role: "assistant", content: "a" },
        { role: "user", content: "second" },
      ],
      tools: { lookup: tool({ inputSchema: z.object({}) }) },
    });
    expect(seen).toEqual({
      purpose: "t.capture",
      role: "main",
      lastUserText: "second",
      system: "Be kind.",
      toolNames: ["lookup"],
    });
  });
  it("streams text in at least two chunks, even a single word", async () => {
    for (const text of ["Hello there, friend", "Hi"]) {
      registerMockFixture("t.stream", () => ({ text }));
      const chunks: string[] = [];
      for await (const d of streamText({ model: createMockModel("main", "t.stream"), prompt: "x" })
        .textStream)
        chunks.push(d);
      expect(chunks.length).toBeGreaterThanOrEqual(2);
      expect(chunks.join("")).toBe(text);
    }
  });
  it("returns JSON replies that satisfy Output.object", async () => {
    registerMockFixture("t.json", () => ({ json: { city: "Paris" } }));
    const r = await generateText({
      model: createMockModel("fast", "t.json"),
      prompt: "x",
      output: Output.object({ schema: z.object({ city: z.string() }) }),
    });
    expect(r.output).toEqual({ city: "Paris" });
  });
  it("calls tools, then answers with the reply text after the tool result", async () => {
    registerMockFixture("t.tools", () => ({
      toolCalls: [{ toolName: "add", input: { a: 2, b: 3 } }],
      text: "The sum is 5.",
    }));
    const r = await generateText({
      model: createMockModel("main", "t.tools"),
      prompt: "add",
      stopWhen: isStepCount(3),
      tools: {
        add: tool({
          inputSchema: z.object({ a: z.number(), b: z.number() }),
          execute: async ({ a, b }) => a + b,
        }),
      },
    });
    expect(r.steps[0]?.toolCalls[0]).toMatchObject({ toolName: "add", input: { a: 2, b: 3 } });
    expect(r.steps).toHaveLength(2);
    expect(r.text).toBe("The sum is 5.");
  });
});

describe("mock embeddings and LLM_MODE=mock", () => {
  it("produces deterministic 8-dimensional unit vectors", async () => {
    const { embeddings } = await embedMany({
      model: createMockEmbeddingModel("e"),
      values: ["a", "a", "b"],
    });
    expect(embeddings[0]).toHaveLength(8);
    expect(embeddings[0]).toEqual(embeddings[1]);
    expect(embeddings[0]).not.toEqual(embeddings[2]);
    expect(Math.hypot(...(embeddings[0] ?? []))).toBeCloseTo(1, 6);
  });
  it("swaps every provider kind for mock models", () => {
    for (const kind of ["anthropic", "openai", "google", "openai_compatible"] as const) {
      expect(
        (createLanguageModel({ llmMode: "mock" }, target(kind), "main", "chat") as LanguageModelV4)
          .provider,
      ).toBe("mock");
    }
    expect(createEmbeddingModel({ llmMode: "mock" }, target("anthropic"))).not.toBeNull();
  });
});
