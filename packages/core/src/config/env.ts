import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { ConfigError } from "../errors";

export const SECRET_NAMES = ["APP_ENCRYPTION_KEY", "BETTER_AUTH_SECRET"] as const;
export type SecretName = (typeof SECRET_NAMES)[number];
export type CustomEndpointsMode = "admin_only" | "all" | "off";

export interface SmtpConfig {
  host: string;
  port: number;
  user: string | null;
  pass: string | null;
  from: string;
}

export interface BaseConfig {
  appUrl: string;
  databaseUrl: string;
  secretsDir: string;
  filesDir: string;
  smtp: SmtpConfig | null;
  customEndpoints: CustomEndpointsMode;
  allowPrivateEndpoints: boolean;
  seedDemo: boolean;
  logContent: boolean;
  otelEndpoint: string | null;
}

export interface Secrets {
  appEncryptionKey: Buffer;
  betterAuthSecret: string;
}

export type AppConfig = BaseConfig & Secrets;

// Compose passes `${VAR:-}`, so an empty string means "unset".
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === "" ? undefined : v), schema.optional());

const bool = optional(z.enum(["true", "false"]).transform((v) => v === "true"));

const envSchema = z.object({
  APP_URL: optional(z.string()),
  DATABASE_URL: z.preprocess((v) => (v === "" ? undefined : v), z.string()),
  SECRETS_DIR: optional(z.string()),
  FILES_DIR: optional(z.string()),
  SMTP_HOST: optional(z.string()),
  SMTP_PORT: optional(z.coerce.number().int().min(1).max(65535)),
  SMTP_USER: optional(z.string()),
  SMTP_PASS: optional(z.string()),
  SMTP_FROM: optional(z.string()),
  CUSTOM_ENDPOINTS: optional(z.enum(["admin_only", "all", "off"])),
  ALLOW_PRIVATE_ENDPOINTS: bool,
  SEED_DEMO: bool,
  LOG_CONTENT: bool,
  OTEL_EXPORTER_OTLP_ENDPOINT: optional(z.string()),
});

function fail(error: z.ZodError): never {
  const detail = error.issues.map((i) => `${i.path.join(".") || "env"}: ${i.message}`).join("; ");
  throw new ConfigError(`Invalid configuration: ${detail}`);
}

export function loadBaseConfig(env: NodeJS.ProcessEnv = process.env): BaseConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) fail(parsed.error);
  const e = parsed.data;

  let smtp: SmtpConfig | null = null;
  if (e.SMTP_HOST) {
    if (!e.SMTP_FROM) throw new ConfigError("SMTP_FROM is required when SMTP_HOST is set.");
    smtp = {
      host: e.SMTP_HOST,
      port: e.SMTP_PORT ?? 587,
      user: e.SMTP_USER ?? null,
      pass: e.SMTP_PASS ?? null,
      from: e.SMTP_FROM,
    };
  }

  return {
    appUrl: (e.APP_URL ?? "http://localhost:3000").replace(/\/+$/, ""),
    databaseUrl: e.DATABASE_URL,
    secretsDir: e.SECRETS_DIR ?? "/var/lib/pathwise/secrets",
    filesDir: e.FILES_DIR ?? "/var/lib/pathwise/files",
    smtp,
    customEndpoints: e.CUSTOM_ENDPOINTS ?? "admin_only",
    allowPrivateEndpoints: e.ALLOW_PRIVATE_ENDPOINTS ?? false,
    seedDemo: e.SEED_DEMO ?? false,
    logContent: e.LOG_CONTENT ?? false,
    otelEndpoint: e.OTEL_EXPORTER_OTLP_ENDPOINT ?? null,
  };
}

function readSecret(name: SecretName, env: NodeJS.ProcessEnv, secretsDir: string): string {
  const fromEnv = env[name];
  if (fromEnv) return fromEnv.trim();
  const path = join(secretsDir, name);
  if (!existsSync(path)) {
    throw new ConfigError(
      `${name} is not set and ${path} does not exist. Run the init service (docker compose up) or set ${name}.`,
    );
  }
  return readFileSync(path, "utf8").trim();
}

export function decodeEncryptionKey(raw: string): Buffer {
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new ConfigError("APP_ENCRYPTION_KEY must be 32 bytes, base64-encoded.");
  }
  return key;
}

export function loadSecrets(env: NodeJS.ProcessEnv, secretsDir: string): Secrets {
  return {
    appEncryptionKey: decodeEncryptionKey(readSecret("APP_ENCRYPTION_KEY", env, secretsDir)),
    betterAuthSecret: readSecret("BETTER_AUTH_SECRET", env, secretsDir),
  };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const base = loadBaseConfig(env);
  return { ...base, ...loadSecrets(env, base.secretsDir) };
}
