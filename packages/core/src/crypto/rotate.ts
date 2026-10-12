import { randomBytes } from "node:crypto";
import { closeSync, fsyncSync, openSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { eq, isNotNull } from "drizzle-orm";
import { type AppConfig, decodeEncryptionKey } from "../config";
import { type Db, schema } from "../db";
import { ConfigError } from "../errors";
import { loadKeyring } from "./keyring";
import { decryptSecret, encryptSecret, SecretDecryptError } from "./secret";

function fsyncPath(path: string): void {
  const fd = openSync(path, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

/** Durable write: fsync the temp file before the rename and the directory after it. */
function writeKeyFile(path: string, key: Buffer): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, key.toString("base64"), { mode: 0o600 });
  fsyncPath(tmp);
  renameSync(tmp, path);
  fsyncPath(dirname(path));
}

function readNextKey(path: string): Buffer | null {
  try {
    return decodeEncryptionKey(readFileSync(path, "utf8").trim());
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new ConfigError(`Key file ${path} is invalid: ${(e as Error).message}`);
  }
}

/**
 * Crash-safe rotation. Order: verify rows decrypt, write `.next`, re-encrypt in one transaction,
 * write `.previous`, rename `.next` over the key file. The key file always exists, and `loadKeyring`
 * reads `.next`, so running processes can decrypt at every instant. Re-running finishes a crashed run.
 */
export async function rotateEncryptionKey(
  db: Db,
  config: Pick<AppConfig, "appEncryptionKey" | "secretsDir">,
  env: Record<string, string | undefined>,
): Promise<{ rotated: number }> {
  const keyPath = join(config.secretsDir, "APP_ENCRYPTION_KEY");
  const nextPath = `${keyPath}.next`;
  const previousPath = `${keyPath}.previous`;
  if (env.APP_ENCRYPTION_KEY) {
    throw new ConfigError(
      `APP_ENCRYPTION_KEY is set in the environment, so rotation can't replace it: the environment value always wins over the secrets volume. To rotate, move the value into ${keyPath} (mode 0600), remove the variable, restart, then run this command again.`,
    );
  }

  const existingNext = readNextKey(nextPath);
  const others = loadKeyring(config).others;
  const decryptWith = (newKey: Buffer | null) => ({
    current: config.appEncryptionKey,
    others: newKey ? [newKey, ...others] : others,
  });
  const undecryptable = (id: string) =>
    new ConfigError(
      `Provider config ${id} cannot be decrypted with any available key. Delete it or re-enter its key, then run this command again.`,
    );
  const decryptRow = (
    keyring: ReturnType<typeof decryptWith>,
    row: { id: string; encryptedKey: string | null },
  ) => {
    try {
      return decryptSecret(keyring, row.encryptedKey ?? "", row.id);
    } catch (e) {
      if (e instanceof SecretDecryptError) throw undecryptable(row.id);
      throw e;
    }
  };

  // Verify first so an aborted rotation leaves no `.next` file behind.
  const stored = {
    id: schema.providerConfigs.id,
    encryptedKey: schema.providerConfigs.encryptedKey,
  };
  const precheck = decryptWith(existingNext);
  for (const row of await db
    .select(stored)
    .from(schema.providerConfigs)
    .where(isNotNull(schema.providerConfigs.encryptedKey))) {
    decryptRow(precheck, row);
  }

  let newKey = existingNext;
  if (!newKey) {
    newKey = randomBytes(32);
    writeKeyFile(nextPath, newKey);
  }
  const target = newKey;

  const rotated = await db.transaction(async (tx) => {
    const rows = await tx
      .select(stored)
      .from(schema.providerConfigs)
      .where(isNotNull(schema.providerConfigs.encryptedKey))
      .for("update");
    const keyring = decryptWith(target);
    for (const row of rows) {
      const plain = decryptRow(keyring, row);
      await tx
        .update(schema.providerConfigs)
        .set({ encryptedKey: encryptSecret({ current: target, others: [] }, plain, row.id) })
        .where(eq(schema.providerConfigs.id, row.id));
    }
    return rows.length;
  });

  writeKeyFile(previousPath, config.appEncryptionKey);
  renameSync(nextPath, keyPath);
  fsyncPath(config.secretsDir);
  return { rotated };
}
