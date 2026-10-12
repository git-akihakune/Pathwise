import { APICallError, simulateReadableStream } from "ai";
import { MockLanguageModelV4, mockValues } from "ai/test";
import { beforeEach, describe, expect, it } from "vitest";
import { getTestDb, resetDb } from "../../../../test/integration/db";
import { insertConfig, seedUser, testConfig } from "../../../../test/integration/fixtures";
import { schema } from "../db";
import { type ProbeTarget, probeCapabilities } from "./probe";

const db = getTestDb();
const deps = { db, config: testConfig() };
const usage = {
  inputTokens: { total: 5, noCache: 5, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};
const done = (unified: "stop" | "tool-calls") => ({
  finishReason: { unified, raw: undefined },
  usage,
  warnings: [],
});
const text = (t: string) => ({ content: [{ type: "text" as const, text: t }], ...done("stop") });
const toolCall = (toolName: string, input: unknown) => ({
  content: [
    { type: "tool-call" as const, toolCallId: "c1", toolName, input: JSON.stringify(input) },
  ],
  ...done("tool-calls"),
});
const stream = (...deltas: string[]) => ({
  stream: simulateReadableStream({
    chunks: [
      { type: "text-start" as const, id: "t" },
      ...deltas.map((delta) => ({ type: "text-delta" as const, id: "t", delta })),
      { type: "text-end" as const, id: "t" },
      {
        type: "finish" as const,
        finishReason: { unified: "stop" as const, raw: undefined },
        usage,
      },
    ],
  }),
});
// Pinned call order per model: basic (generate), streaming (stream), tools (generate), jsonSchema (generate).
function model(gen: unknown[], str = () => stream("1 2 ", "3 4 5")) {
  const next = mockValues(...gen);
  return new MockLanguageModelV4({
    modelId: "m",
    doStream: async () => str(),
    doGenerate: async () => {
      const r = next();
      if (r instanceof Error) throw r;
      return r as never;
    },
  });
}
const GOOD = () => [
  text("ready"),
  toolCall("echo", { value: "pathwise" }),
  text('{"city":"Paris","population":2100000}'),
];
let target: ProbeTarget;

beforeEach(async () => {
  await resetDb(db);
  await seedUser(db, "u1");
  const id = await insertConfig(db, deps.config, {
    userId: "u1",
    kind: "openai_compatible",
    baseUrl: "http://127.0.0.1:8080/v1",
    status: "untested",
  });
  target = {
    id,
    userId: "u1",
    kind: "openai_compatible",
    baseUrl: "http://127.0.0.1:8080/v1",
    apiKey: null,
    models: { main: "m", fast: "m" },
    contextWindow: null,
    capabilities: null,
  };
});

describe("probeCapabilities", () => {
  it("reports full support when every check passes, and records usage under purpose probe", async () => {
    const r = await probeCapabilities(deps, target, { model: () => model(GOOD()) });
    expect(r.status).toBe("full");
    expect(r.checks).toEqual({
      basic: { ok: true },
      streaming: { ok: true },
      tools: { ok: true },
      jsonSchema: { ok: true },
    });
    expect(r.capabilities).toEqual({
      basic: true,
      streaming: true,
      tools: true,
      jsonSchema: true,
      pdfInput: false,
      contextWindow: 8192,
    });
    const rows = await db.select().from(schema.llmUsage);
    expect(rows.map((u) => u.purpose)).toEqual(["probe", "probe", "probe", "probe"]);
  });
  it("is degraded when the model answers in text instead of calling the tool", async () => {
    const r = await probeCapabilities(deps, target, {
      model: () =>
        model([text("ready"), text("I would call echo."), text('{"city":"Paris","population":1}')]),
    });
    expect(r.status).toBe("degraded");
    expect(r.checks.tools).toEqual({
      ok: false,
      error: "The model replied without calling the tool.",
    });
  });
  it("is degraded when structured output is not schema-valid", async () => {
    const r = await probeCapabilities(deps, target, {
      model: () =>
        model([text("ready"), toolCall("echo", { value: "pathwise" }), text("About two million.")]),
    });
    expect(r.status).toBe("degraded");
    expect(r.checks.jsonSchema.error).toMatch(/did not match the schema/);
  });
  it("is unsupported when streaming yields a single chunk", async () => {
    const r = await probeCapabilities(deps, target, {
      model: () => model(GOOD(), () => stream("1 2 3 4 5")),
    });
    expect(r.status).toBe("unsupported");
    expect(r.checks.streaming.ok).toBe(false);
  });
  it("explains a rejected key and skips the remaining checks", async () => {
    const denied = new APICallError({
      message: "invalid key",
      url: "https://x",
      requestBodyValues: {},
      statusCode: 401,
    });
    const r = await probeCapabilities(deps, target, { model: () => model([denied]) });
    expect(r.status).toBe("unsupported");
    expect(r.authRejected).toBe(true);
    expect(r.checks.basic).toEqual({
      ok: false,
      error: "The provider rejected the API key (HTTP 401).",
    });
    expect(r.checks.tools).toEqual({ ok: false, error: "Skipped because the basic check failed." });
  });
  it("also checks the fast model when it differs", async () => {
    const r = await probeCapabilities(
      deps,
      { ...target, models: { main: "m", fast: "m-fast" } },
      {
        model: (role) =>
          role === "fast" ? model([new Error("model m-fast not found")]) : model(GOOD()),
      },
    );
    expect(r.status).toBe("unsupported");
    expect(r.checks.basic.error).toMatch(/^Fast model: model m-fast not found/);
  });
  it("passes with full support in LLM_MODE=mock via the probe fixture", async () => {
    const r = await probeCapabilities(
      { db, config: testConfig({ llmMode: "mock" }) },
      { ...target, kind: "openai", baseUrl: null, apiKey: "sk-fake" },
    );
    expect(r.status).toBe("full");
    expect(r.capabilities.contextWindow).toBe(128_000);
  });
});
