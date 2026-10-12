import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ConfigError } from "../errors";
import { loadBaseConfig, loadSecrets } from "./env";

const DB = { DATABASE_URL: "postgres://u:p@localhost:5432/db" };
const key32 = Buffer.alloc(32, 7).toString("base64");

describe("loadBaseConfig", () => {
  it("applies defaults", () => {
    expect(loadBaseConfig(DB)).toEqual({
      appUrl: "http://localhost:3000",
      databaseUrl: DB.DATABASE_URL,
      secretsDir: "/var/lib/pathwise/secrets",
      filesDir: "/var/lib/pathwise/files",
      smtp: null,
      customEndpoints: "admin_only",
      allowPrivateEndpoints: false,
      seedDemo: false,
      logContent: false,
      otelEndpoint: null,
    });
  });
  it("rejects an APP_URL that is not an http(s) URL", () => {
    for (const bad of ["coach.example.com", "ftp://x.io"]) {
      expect(() => loadBaseConfig({ ...DB, APP_URL: bad })).toThrow(ConfigError);
      expect(() => loadBaseConfig({ ...DB, APP_URL: bad })).toThrow(/APP_URL/);
    }
  });
  it("strips a trailing slash from APP_URL", () => {
    expect(loadBaseConfig({ ...DB, APP_URL: "https://coach.example.com/" }).appUrl).toBe(
      "https://coach.example.com",
    );
  });
  it("treats empty strings as unset (compose passes empty defaults)", () => {
    const c = loadBaseConfig({ ...DB, SMTP_HOST: "", CUSTOM_ENDPOINTS: "", SEED_DEMO: "" });
    expect(c.smtp).toBeNull();
    expect(c.customEndpoints).toBe("admin_only");
    expect(c.seedDemo).toBe(false);
  });
  it("requires DATABASE_URL", () => {
    expect(() => loadBaseConfig({})).toThrow(ConfigError);
  });
  it("rejects an unknown CUSTOM_ENDPOINTS value", () => {
    expect(() => loadBaseConfig({ ...DB, CUSTOM_ENDPOINTS: "everyone" })).toThrow(
      /CUSTOM_ENDPOINTS/,
    );
  });
  it("rejects non-boolean flags", () => {
    expect(() => loadBaseConfig({ ...DB, SEED_DEMO: "yes" })).toThrow(/SEED_DEMO/);
  });
  it("builds SMTP config with port default 587 and requires SMTP_FROM", () => {
    expect(loadBaseConfig({ ...DB, SMTP_HOST: "smtp.x", SMTP_FROM: "a@x" }).smtp).toEqual({
      host: "smtp.x",
      port: 587,
      user: null,
      pass: null,
      from: "a@x",
    });
    expect(() => loadBaseConfig({ ...DB, SMTP_HOST: "smtp.x" })).toThrow(/SMTP_FROM/);
  });
});

describe("loadSecrets", () => {
  const dir = mkdtempSync(join(tmpdir(), "pw-secrets-"));
  writeFileSync(join(dir, "APP_ENCRYPTION_KEY"), `${key32}\n`);
  writeFileSync(join(dir, "BETTER_AUTH_SECRET"), "file-secret\n");

  it("reads trimmed values from files", () => {
    const s = loadSecrets({}, dir);
    expect(s.appEncryptionKey.length).toBe(32);
    expect(s.betterAuthSecret).toBe("file-secret");
  });
  it("prefers env over files", () => {
    expect(loadSecrets({ BETTER_AUTH_SECRET: "env-secret" }, dir).betterAuthSecret).toBe(
      "env-secret",
    );
  });
  it("rejects an encryption key that is not 32 bytes", () => {
    expect(() =>
      loadSecrets({ APP_ENCRYPTION_KEY: Buffer.alloc(16).toString("base64") }, dir),
    ).toThrow(/APP_ENCRYPTION_KEY/);
  });
  it("explains how to fix a missing secret", () => {
    expect(() => loadSecrets({}, mkdtempSync(join(tmpdir(), "pw-empty-")))).toThrow(/init/);
  });
});
