import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  LanguageModelV4GenerateResult,
  LanguageModelV4StreamPart,
  LanguageModelV4StreamResult,
} from "@ai-sdk/provider";
import type { EmbeddingModel, LanguageModel, ToolSet, UIMessageChunk } from "ai";
import { convertArrayToReadableStream, MockEmbeddingModelV4 } from "ai/test";
import { inject } from "vitest";
import type { AppConfig } from "../../packages/core/src/config";
import { encryptSecret } from "../../packages/core/src/crypto";
import { type Db, schema } from "../../packages/core/src/db";
import type { JobQueue } from "../../packages/core/src/jobs";
import type {
  Capabilities,
  Llm,
  LlmDeps,
  ProviderKind,
  ProviderModels,
  ProviderStatus,
} from "../../packages/core/src/llm/types";
import { activateProviderConfig } from "../../packages/core/src/services/providers";

export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    appUrl: "http://localhost:3000",
    databaseUrl: inject("databaseUrl"),
    secretsDir: mkdtempSync(join(tmpdir(), "pathwise-secrets-")),
    filesDir: "/tmp/pathwise-files",
    smtp: null,
    customEndpoints: "admin_only",
    allowPrivateEndpoints: false,
    seedDemo: false,
    logContent: false,
    otelEndpoint: null,
    llmMode: "live",
    taxonomyDir: "/app/data/taxonomy",
    appEncryptionKey: Buffer.alloc(32, 1),
    betterAuthSecret: "test-secret",
    ...overrides,
  };
}

export async function seedUser(db: Db, id: string, role: "admin" | "user" = "user"): Promise<void> {
  await db
    .insert(schema.user)
    .values({ id, name: id, email: `${id}@x.io`, emailVerified: false, role });
}

export const FULL_CAPS: Capabilities = {
  basic: true,
  streaming: true,
  tools: true,
  jsonSchema: true,
  pdfInput: true,
  contextWindow: 128000,
};

export async function insertConfig(
  db: Db,
  config: AppConfig,
  row: {
    userId: string | null;
    kind?: ProviderKind;
    baseUrl?: string;
    status?: ProviderStatus;
    authFailed?: boolean;
    apiKey?: string;
    models?: ProviderModels;
  },
): Promise<string> {
  const id = randomUUID();
  const status = row.status ?? "full";
  const apiKey = row.apiKey ?? "sk-test-key-1234";
  await db.insert(schema.providerConfigs).values({
    id,
    userId: row.userId,
    kind: row.kind ?? "openai",
    label: "test",
    baseUrl: row.baseUrl ?? null,
    encryptedKey: apiKey
      ? encryptSecret({ current: config.appEncryptionKey, others: [] }, apiKey, id)
      : null,
    keyLast4: apiKey ? apiKey.slice(-4) : null,
    models: row.models ?? { main: "m-main", fast: "m-fast" },
    capabilities: status === "untested" ? null : FULL_CAPS,
    status,
    authFailed: row.authFailed ?? false,
  });
  return id;
}

export async function seedProvider(
  db: Db,
  userId: string,
  opts: { embedding?: string } = {},
): Promise<string> {
  const id = await insertConfig(db, testConfig(), {
    userId,
    models: { main: "m-main", fast: "m-fast", embedding: opts.embedding },
  });
  await activateProviderConfig(db, userId, id);
  return id;
}

export function testDeps(db: Db, o: { llmMode?: "live" | "mock" } = {}): LlmDeps {
  return { db, config: testConfig({ llmMode: o.llmMode ?? "live" }) };
}

export function fakeQueue(): JobQueue & {
  sent: { name: string; data: object; opts?: object }[];
} {
  const sent: { name: string; data: object; opts?: object }[] = [];
  return {
    sent,
    async send(name, data, opts) {
      sent.push(opts ? { name, data, opts } : { name, data });
    },
  };
}

const REPLY_USAGE = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};

export function textReply(text: string): LanguageModelV4GenerateResult {
  return {
    content: [{ type: "text", text }],
    finishReason: { unified: "stop", raw: undefined },
    usage: REPLY_USAGE,
    warnings: [],
  };
}

export function jsonReply(obj: unknown): LanguageModelV4GenerateResult {
  return textReply(JSON.stringify(obj));
}

const streamOf = (parts: LanguageModelV4StreamPart[]): LanguageModelV4StreamResult => ({
  stream: convertArrayToReadableStream<LanguageModelV4StreamPart>([
    { type: "stream-start", warnings: [] },
    ...parts,
  ]),
});
const textParts = (deltas: string[]): LanguageModelV4StreamPart[] => [
  { type: "text-start", id: "t1" },
  ...deltas.map((delta) => ({ type: "text-delta" as const, id: "t1", delta })),
  { type: "text-end", id: "t1" },
];

/** A streamed text reply that finishes with `stop` and the usage of `textReply`. */
export function textStream(...deltas: string[]): LanguageModelV4StreamResult {
  return streamOf([
    ...textParts(deltas),
    { type: "finish", finishReason: { unified: "stop", raw: undefined }, usage: REPLY_USAGE },
  ]);
}

/** A streamed single tool call (id "c1") that finishes with `tool-calls`. */
export function toolCallStream(toolName: string, input: unknown): LanguageModelV4StreamResult {
  return streamOf([
    { type: "tool-call", toolCallId: "c1", toolName, input: JSON.stringify(input) },
    { type: "finish", finishReason: { unified: "tool-calls", raw: undefined }, usage: REPLY_USAGE },
  ]);
}

/** Streams some text, then fails with `error` (a provider dying mid-reply). */
export function erroringStream(deltas: string[], error: unknown): LanguageModelV4StreamResult {
  return streamOf([...textParts(deltas), { type: "error", error }]);
}

/** Reads a UI message stream response body into its chunks (SSE `data:` lines, without `[DONE]`). */
export async function readUIStream(res: Response): Promise<UIMessageChunk[]> {
  const body = await res.text();
  return body
    .split("\n")
    .filter((line) => line.startsWith("data: ") && line !== "data: [DONE]")
    .map((line) => JSON.parse(line.slice("data: ".length)) as UIMessageChunk);
}

/** An Llm whose models are scripted: `model(role, purpose)` returns models[purpose] ?? models["*"]. */
export function fakeLlm(o: {
  userId: string;
  providerConfigId: string;
  models: Record<string, LanguageModel>;
  capabilities?: Partial<Capabilities>;
  embedding?: { model: EmbeddingModel; modelId: string };
}): Llm {
  return {
    userId: o.userId,
    providerConfigId: o.providerConfigId,
    kind: "openai",
    capabilities: { ...FULL_CAPS, ...o.capabilities },
    model(_role, purpose) {
      const m = o.models[purpose] ?? o.models["*"];
      if (!m) throw new Error(`fakeLlm: no model for purpose "${purpose}"`);
      return m;
    },
    modelId: (role) => `fake-${role}`,
    embedding: o.embedding ? { ...o.embedding, providerConfigId: o.providerConfigId } : null,
  };
}

/** An embedding model returning `map[value] ?? fallback ?? [0, 0, 1]` for each input. */
export function embeddingModel(
  map: Record<string, number[]>,
  fallback?: number[],
): MockEmbeddingModelV4 {
  return new MockEmbeddingModelV4({
    doEmbed: async ({ values }) => ({
      embeddings: values.map((v) => map[v] ?? fallback ?? [0, 0, 1]),
      usage: { tokens: values.length },
      warnings: [],
    }),
  });
}

/** Runs a tool's execute the way the AI SDK would, for tests. */
export async function runTool(tools: ToolSet, name: string, input: unknown): Promise<unknown> {
  const t = tools[name];
  if (!t?.execute) throw new Error(`No executable tool: ${name}`);
  return t.execute(input, { toolCallId: "t1", messages: [], context: undefined });
}
