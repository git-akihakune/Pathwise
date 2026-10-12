import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ConfigError } from "../errors";
import { decodeEncryptionKey, SECRET_NAMES, type SecretName } from "./env";

function assertValid(name: SecretName, path: string): void {
  let value: string;
  try {
    value = readFileSync(path, "utf8").trim();
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code ?? "unknown error";
    throw new ConfigError(
      `Secret file ${path} could not be read (${code}). Check its permissions and that it is a regular file; it was not modified.`,
    );
  }
  try {
    if (!value) throw new ConfigError("empty");
    if (name === "APP_ENCRYPTION_KEY") decodeEncryptionKey(value);
  } catch {
    throw new ConfigError(
      `Secret file ${path} is invalid; refusing to overwrite it because stored API keys depend on it. Fix or remove it manually.`,
    );
  }
}

/** Generates any secret that is neither in env nor on disk. Idempotent; never overwrites. */
export async function ensureSecrets(
  secretsDir: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ generated: SecretName[] }> {
  await mkdir(secretsDir, { recursive: true, mode: 0o700 });
  const generated: SecretName[] = [];
  for (const name of SECRET_NAMES) {
    if (env[name]) continue;
    const path = join(secretsDir, name);
    if (existsSync(path)) {
      assertValid(name, path);
      continue;
    }
    const tmp = `${path}.tmp-${process.pid}`;
    await writeFile(tmp, randomBytes(32).toString("base64"), { mode: 0o600 });
    await rename(tmp, path);
    generated.push(name);
  }
  return { generated };
}
