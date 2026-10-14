import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type AppConfig, decodeEncryptionKey } from "../config";
import { ConfigError } from "../errors";
import type { Keyring } from "./secret";

const KEY_FILES = ["APP_ENCRYPTION_KEY", "APP_ENCRYPTION_KEY.next", "APP_ENCRYPTION_KEY.previous"];

/** Reads the key files on every call so long-running processes see rotation files without a restart. */
export function loadKeyring(config: Pick<AppConfig, "appEncryptionKey" | "secretsDir">): Keyring {
  const current = config.appEncryptionKey;
  const others: Buffer[] = [];
  for (const name of KEY_FILES) {
    const path = join(config.secretsDir, name);
    let raw: string;
    try {
      raw = readFileSync(path, "utf8").trim();
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw new ConfigError(`Key file ${path} is invalid: ${(e as Error).message}`);
    }
    let key: Buffer;
    try {
      key = decodeEncryptionKey(raw);
    } catch (e) {
      throw new ConfigError(`Key file ${path} is invalid: ${(e as Error).message}`);
    }
    if (!key.equals(current) && !others.some((o) => o.equals(key))) others.push(key);
  }
  return { current, others };
}
