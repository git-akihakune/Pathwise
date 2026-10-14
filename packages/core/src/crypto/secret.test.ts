import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, keyId, SecretDecryptError } from "./secret";

const k1 = Buffer.alloc(32, 1);
const k2 = Buffer.alloc(32, 2);
const ring = { current: k1, others: [] };
const flip = (part = "") => {
  const b = Buffer.from(part, "base64url");
  b[0] = (b[0] ?? 0) ^ 1;
  return b.toString("base64url");
};

describe("encryptSecret / decryptSecret", () => {
  it("round-trips in the documented format with a fresh IV each time", () => {
    const p = encryptSecret(ring, "sk-ant-secret-1234", "cfg-1");
    expect(p).toMatch(/^v1:[0-9a-f]{8}:[\w-]+:[\w-]+:[\w-]+$/);
    expect(p.split(":")[1]).toBe(keyId(k1));
    expect(p).not.toContain("secret");
    expect(decryptSecret(ring, p, "cfg-1")).toBe("sk-ant-secret-1234");
    expect(encryptSecret(ring, "x", "a")).not.toBe(encryptSecret(ring, "x", "a"));
  });
  it("fails with the wrong AAD (a payload copied to another row)", () => {
    expect(() => decryptSecret(ring, encryptSecret(ring, "x", "cfg-1"), "cfg-2")).toThrow(
      SecretDecryptError,
    );
  });
  it("fails when the ciphertext or the tag is tampered with", () => {
    const [v, id, iv, tag, ct] = encryptSecret(ring, "hello world", "a").split(":");
    expect(() => decryptSecret(ring, [v, id, iv, tag, flip(ct)].join(":"), "a")).toThrow(
      SecretDecryptError,
    );
    expect(() => decryptSecret(ring, [v, id, iv, flip(tag), ct].join(":"), "a")).toThrow(
      SecretDecryptError,
    );
  });
  it("rejects a truncated authentication tag", () => {
    const [v, id, iv, tag, ct] = encryptSecret(ring, "hello world", "a").split(":");
    const short = Buffer.from(tag ?? "", "base64url")
      .subarray(0, 4)
      .toString("base64url");
    expect(() => decryptSecret(ring, [v, id, iv, short, ct].join(":"), "a")).toThrow(
      SecretDecryptError,
    );
  });
  it("decrypts with a non-current key chosen by key id", () => {
    const old = encryptSecret({ current: k2, others: [] }, "x", "a");
    expect(decryptSecret({ current: k1, others: [k2] }, old, "a")).toBe("x");
  });
  it("names the key id when the key is not in the keyring, and rejects malformed payloads", () => {
    const p = encryptSecret({ current: randomBytes(32), others: [] }, "x", "a");
    expect(() => decryptSecret(ring, p, "a")).toThrow(
      new RegExp(`key ${p.split(":")[1]}, which is not in the keyring`),
    );
    expect(() => decryptSecret(ring, "sk-plaintext", "a")).toThrow(SecretDecryptError);
  });
});
