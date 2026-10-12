import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inject } from "vitest";
import type { AppConfig } from "../../packages/core/src/config";
import { encryptSecret } from "../../packages/core/src/crypto";
import { type Db, schema } from "../../packages/core/src/db";
import type {
  Capabilities,
  ProviderKind,
  ProviderModels,
  ProviderStatus,
} from "../../packages/core/src/llm/types";

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
