import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export interface Keyring {
  current: Buffer;
  others: Buffer[];
}

export class SecretDecryptError extends Error {
  override name = "SecretDecryptError";
}

/** First 8 hex chars of sha256(key). */
export function keyId(key: Buffer): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 8);
}

export function encryptSecret(keyring: Keyring, plaintext: string, aad: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyring.current, iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    "v1",
    keyId(keyring.current),
    iv.toString("base64url"),
    tag.toString("base64url"),
    ct.toString("base64url"),
  ].join(":");
}

export function decryptSecret(keyring: Keyring, payload: string, aad: string): string {
  const parts = payload.split(":");
  if (parts.length !== 5 || parts[0] !== "v1") {
    throw new SecretDecryptError("Malformed encrypted secret");
  }
  const [, id, iv, tag, ct] = parts as [string, string, string, string, string];
  const key = [keyring.current, ...keyring.others].find((k) => keyId(k) === id);
  if (!key) {
    throw new SecretDecryptError(
      `Secret was encrypted with key ${id}, which is not in the keyring. Restore the pathwise-secrets volume or re-enter the API key.`,
    );
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
    decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(ct, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new SecretDecryptError("Encrypted secret failed authentication");
  }
}
