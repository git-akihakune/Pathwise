import { createServer } from "node:http";
import { OpenTelemetry } from "@ai-sdk/otel";
import type { LanguageModelV4Content, LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { SpanStatusCode } from "@opentelemetry/api";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { generateText, streamText, type Telemetry, tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { contentFree, otlpTracesUrl, startTelemetry } from ".";

const { warn, info } = vi.hoisted(() => ({ warn: vi.fn(), info: vi.fn() }));
vi.mock("../logger", () => ({ createLogger: () => ({ warn, info }) }));
const exporter = new InMemorySpanExporter();
const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
const otel = () => new OpenTelemetry({ tracer: provider.getTracer("test") });
const usage = {
  inputTokens: { total: 5, noCache: 5, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 2, text: 2, reasoning: 0 },
};
const secrets = /PROMPT-SECRET|REPLY-SECRET|TOOL-INPUT-SECRET|TOOL-OUTPUT-SECRET|ERROR-SECRET/;
const spans = () =>
  JSON.stringify(
    exporter.getFinishedSpans().map((span) => ({
      name: span.name,
      attributes: span.attributes,
      events: span.events,
      status: span.status,
    })),
  );
const model = (content: LanguageModelV4Content[] = [{ type: "text", text: "REPLY-SECRET" }]) =>
  new MockLanguageModelV4({
    doGenerate: async () => ({
      content,
      finishReason: { unified: "stop", raw: undefined },
      usage,
      warnings: [],
    }),
    doStream: async () => ({
      stream: new ReadableStream<LanguageModelV4StreamPart>({
        start(controller) {
          controller.enqueue({ type: "stream-start", warnings: [] });
          controller.enqueue({ type: "text-start", id: "text" });
          controller.enqueue({ type: "text-delta", id: "text", delta: "REPLY-SECRET" });
          controller.enqueue({ type: "text-end", id: "text" });
          for (const part of content) {
            if (part.type === "tool-call") controller.enqueue(part);
          }
          controller.enqueue({
            type: "finish",
            finishReason: { unified: "stop", raw: undefined },
            usage,
          });
          controller.close();
        },
      }),
    }),
  });
const toolCall: LanguageModelV4Content = {
  type: "tool-call",
  toolCallId: "call-1",
  toolName: "lookup",
  input: JSON.stringify({ query: "TOOL-INPUT-SECRET" }),
};
const tools = (fail = false) => ({
  lookup: tool({
    inputSchema: z.object({ query: z.string() }),
    execute: async ({ query }) => {
      expect(query).toBe("TOOL-INPUT-SECRET");
      if (fail) throw new Error("ERROR-SECRET TOOL-OUTPUT-SECRET");
      return "TOOL-OUTPUT-SECRET";
    },
  }),
});
const telemetry = (integration: Telemetry) => ({
  integrations: [integration],
  recordInputs: true,
  recordOutputs: true,
});
let previous: Telemetry[] | undefined;
beforeEach(() => {
  exporter.reset();
  vi.clearAllMocks();
  previous = globalThis.AI_SDK_TELEMETRY_INTEGRATIONS;
  globalThis.AI_SDK_TELEMETRY_INTEGRATIONS = undefined;
});
afterEach(() => {
  globalThis.AI_SDK_TELEMETRY_INTEGRATIONS = previous;
});

function expectPrivate() {
  expect(exporter.getFinishedSpans().length).toBeGreaterThan(0);
  expect(spans()).not.toMatch(secrets);
  expect(
    exporter
      .getFinishedSpans()
      .some(
        (span) =>
          span.attributes["gen_ai.usage.input_tokens"] === 5 &&
          span.attributes["gen_ai.usage.output_tokens"] === 2,
      ),
  ).toBe(true);
  expect(
    exporter.getFinishedSpans().some((span) => span.duration[0] > 0 || span.duration[1] > 0),
  ).toBe(true);
}

describe("telemetry content privacy", () => {
  it("omits generation prompts and replies even when call settings request content", async () => {
    const result = await generateText({
      model: model(),
      prompt: "PROMPT-SECRET",
      telemetry: telemetry(contentFree(otel())),
    });
    expect(result.text).toBe("REPLY-SECRET");
    expectPrivate();
  });
  it("omits streamed prompts and replies without altering the response", async () => {
    const result = streamText({
      model: model(),
      prompt: "PROMPT-SECRET",
      telemetry: telemetry(contentFree(otel())),
    });
    await result.consumeStream();
    expect(await result.text).toBe("REPLY-SECRET");
    expectPrivate();
  });
  it.each([false, true])("omits tool inputs and outputs (stream=%s)", async (stream) => {
    const options = {
      model: model([toolCall]),
      tools: tools(),
      prompt: "PROMPT-SECRET",
      telemetry: telemetry(contentFree(otel())),
    };
    if (stream) {
      const result = streamText(options);
      await result.consumeStream();
      expect((await result.toolResults)[0]?.output).toBe("TOOL-OUTPUT-SECRET");
    } else {
      expect((await generateText(options)).toolResults[0]?.output).toBe("TOOL-OUTPUT-SECRET");
    }
    expectPrivate();
    expect(spans()).toContain("gen_ai.execute_tool.duration");
  });
  it("omits failed tool error content while retaining trace failure status", async () => {
    const result = await generateText({
      model: model([toolCall]),
      tools: tools(true),
      prompt: "PROMPT-SECRET",
      telemetry: telemetry(contentFree(otel())),
    });
    expect(result.content.find((part) => part.type === "tool-error")?.error).toEqual(
      new Error("ERROR-SECRET TOOL-OUTPUT-SECRET"),
    );
    expectPrivate();
    expect(
      exporter.getFinishedSpans().find((span) => span.name === "execute_tool lookup")?.status.code,
    ).toBe(SpanStatusCode.ERROR);
  });
  it.each([false, true])(
    "omits provider errors without changing application errors (stream=%s)",
    async (stream) => {
      const error = new Error("ERROR-SECRET PROMPT-SECRET");
      const broken = new MockLanguageModelV4({
        doGenerate: async () => {
          throw error;
        },
        doStream: async () => {
          throw error;
        },
      });
      const options = {
        model: broken,
        prompt: "PROMPT-SECRET",
        maxRetries: 0,
        telemetry: telemetry(contentFree(otel())),
      };
      if (stream) {
        const result = streamText({ ...options, onError: () => {} });
        const chunks = [];
        for await (const chunk of result.fullStream) chunks.push(chunk);
        expect(chunks.find((chunk) => chunk.type === "error")?.error).toBe(error);
      } else {
        await expect(generateText(options)).rejects.toBe(error);
      }
      expect(exporter.getFinishedSpans().length).toBeGreaterThan(0);
      expect(spans()).not.toMatch(secrets);
      expect(
        exporter.getFinishedSpans().some((span) => span.status.code === SpanStatusCode.ERROR),
      ).toBe(true);
    },
  );
  it("preserves context execution hooks and forces their privacy flags", async () => {
    const receiver: Telemetry = {
      async executeTool(options) {
        expect(this).toBe(receiver);
        expect(options.recordInputs).toBe(false);
        expect(options.recordOutputs).toBe(false);
        return await options.execute();
      },
      async executeLanguageModelCall(options) {
        expect(this).toBe(receiver);
        expect(options.recordInputs).toBe(false);
        expect(options.recordOutputs).toBe(false);
        return await options.execute();
      },
    };
    const wrapped = contentFree(receiver);
    await expect(
      wrapped.executeTool?.({
        callId: "call",
        toolCallId: "tool",
        execute: async () => 42,
        recordInputs: true,
        recordOutputs: true,
      }),
    ).resolves.toBe(42);
    await expect(
      wrapped.executeLanguageModelCall?.({
        callId: "call",
        execute: async () => 43,
        recordInputs: true,
        recordOutputs: true,
      }),
    ).resolves.toBe(43);
  });
  it("records prompt, reply and tool content when explicitly unwrapped", async () => {
    await generateText({ model: model(), prompt: "PROMPT-SECRET", telemetry: telemetry(otel()) });
    await generateText({
      model: model([toolCall]),
      tools: tools(),
      prompt: "PROMPT-SECRET",
      telemetry: telemetry(otel()),
    });
    for (const marker of [
      "PROMPT-SECRET",
      "REPLY-SECRET",
      "TOOL-INPUT-SECRET",
      "TOOL-OUTPUT-SECRET",
    ])
      expect(spans()).toContain(marker);
  });
});

describe("telemetry startup", () => {
  it("does not register an integration when disabled", async () => {
    expect(
      await startTelemetry({ otelEndpoint: null, logContent: false }, "pathwise-test"),
    ).toBeNull();
    expect(globalThis.AI_SDK_TELEMETRY_INTEGRATIONS).toBeUndefined();
    expect(info).not.toHaveBeenCalled();
  });
  it("warns and continues when an invalid endpoint fails startup", async () => {
    expect(
      await startTelemetry({ otelEndpoint: "not a URL", logContent: false }, "pathwise-test"),
    ).toBeNull();
    expect(globalThis.AI_SDK_TELEMETRY_INTEGRATIONS).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      "tracing disabled: failed to start",
    );
  });
  it.each([false, true])(
    "exports globally registered traces and flushes on shutdown (LOG_CONTENT=%s)",
    async (logContent) => {
      const requests: { url: string | undefined; body: string }[] = [];
      const server = createServer(async (request, response) => {
        let body = "";
        for await (const chunk of request) body += chunk.toString();
        requests.push({ url: request.url, body });
        response.end("{}");
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      try {
        const address = server.address();
        if (!address || typeof address === "string") throw new Error("missing server address");
        const stop = await startTelemetry(
          { otelEndpoint: `http://127.0.0.1:${address.port}/otlp/`, logContent },
          "pathwise-test",
        );
        expect(stop).toBeTypeOf("function");
        await generateText({ model: model(), prompt: "PROMPT-SECRET" });
        await stop?.();
        expect(requests).toHaveLength(1);
        expect(requests[0]?.url).toBe("/otlp/v1/traces");
        expect(requests[0]?.body).toContain("pathwise-test");
        expect(requests[0]?.body).toContain("gen_ai.usage.input_tokens");
        if (logContent) expect(requests[0]?.body).toMatch(/PROMPT-SECRET/);
        else expect(requests[0]?.body).not.toMatch(secrets);
      } finally {
        await new Promise<void>((resolve, reject) =>
          server.close((err) => (err ? reject(err) : resolve())),
        );
      }
    },
  );
  it.each([
    ["http://collector:4318", "http://collector:4318/v1/traces"],
    ["http://collector:4318///", "http://collector:4318/v1/traces"],
    ["https://otel.example.com/otlp", "https://otel.example.com/otlp/v1/traces"],
  ])("normalizes %s to %s", (endpoint, url) => {
    expect(otlpTracesUrl(endpoint)).toBe(url);
  });
});
