import { type ToolSet, tool } from "ai";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { StructuredOutputError } from "../llm/generate";
import { guardTools, peekForEarlyError } from "./stream";

type Part = { type: string; error?: unknown };
const streamOf = (parts: Part[]) =>
  new ReadableStream<Part>({
    start(c) {
      for (const p of parts) c.enqueue(p);
      c.close();
    },
  });
const readAll = async (s: ReadableStream<Part>) => {
  const out: Part[] = [];
  for await (const p of s) out.push(p);
  return out;
};

describe("peekForEarlyError", () => {
  it("reports an error that arrives before any output and re-emits every part", async () => {
    const boom = new Error("boom");
    const parts = [
      { type: "start" },
      { type: "start-step" },
      { type: "error", error: boom },
      { type: "finish" },
    ];
    const { early, stream } = await peekForEarlyError(streamOf(parts));
    expect(early).toBe(boom);
    expect(await readAll(stream)).toEqual(parts);
  });
  it("reports nothing once output has started", async () => {
    const parts = [
      { type: "start" },
      { type: "text-delta" },
      { type: "error", error: new Error("late") },
    ];
    const { early, stream } = await peekForEarlyError(streamOf(parts));
    expect(early).toBeUndefined();
    expect(await readAll(stream)).toEqual(parts);
  });
});

describe("guardTools", () => {
  const failing: ToolSet = {
    draft: tool({
      inputSchema: z.object({}),
      execute: async (): Promise<{ ok: true }> => {
        throw new StructuredOutputError("bad", ["paths: too few"]);
      },
    }),
  };
  const run = (tools: ToolSet) =>
    tools.draft?.execute?.({}, { toolCallId: "t1", messages: [], context: undefined });

  it("lets the model retry once after invalid output, then tells the user", async () => {
    const state = { failures: 0 };
    const tools = guardTools(failing, state);
    await expect(run(tools)).rejects.toThrow(
      "The generated result was invalid (paths: too few). You may try once more.",
    );
    await expect(run(tools)).rejects.toThrow(
      "I couldn't produce a valid result. Try again, or rephrase your request.",
    );
    expect(state.failures).toBe(2);
  });
});
