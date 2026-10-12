import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inject } from "vitest";
import type { AppConfig } from "../../packages/core/src/config";
import { type Db, schema } from "../../packages/core/src/db";

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
