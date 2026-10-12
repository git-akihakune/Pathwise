import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LanguageModelV4GenerateResult } from "@ai-sdk/provider";
import type { EmbeddingModel, LanguageModel } from "ai";
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
