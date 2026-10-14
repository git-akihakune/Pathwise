import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getTestDb, resetDb } from "../../../../test/integration/db";
import { insertConfig, seedUser, testConfig } from "../../../../test/integration/fixtures";
import { schema } from "../db";
import { decryptSecret, encryptSecret, loadKeyring, rotateEncryptionKey } from ".";

const db = getTestDb();
let dir: string;
let oldKey: Buffer;
const file = (suffix = "") => join(dir, `APP_ENCRYPTION_KEY${suffix}`);
const readKey = (suffix = "") => Buffer.from(readFileSync(file(suffix), "utf8").trim(), "base64");
const cfg = () => testConfig({ secretsDir: dir, appEncryptionKey: readKey() }); // what a freshly started process loads
const rows = () => db.select().from(schema.providerConfigs);
const plaintexts = async (current: Buffer) =>
  (await rows())
    .map((r) => decryptSecret({ current, others: [] }, r.encryptedKey ?? "", r.id))
    .sort();
const writeNext = () => {
  const next = randomBytes(32);
  writeFileSync(file(".next"), next.toString("base64"), { mode: 0o600 });
  return next;
};

beforeEach(async () => {
  await resetDb(db);
  await seedUser(db, "u1");
  dir = mkdtempSync(join(tmpdir(), "pw-rotate-"));
  oldKey = randomBytes(32);
  writeFileSync(file(), oldKey.toString("base64"), { mode: 0o600 });
  await insertConfig(db, cfg(), { userId: "u1", apiKey: "key-one" });
  await insertConfig(db, cfg(), { userId: null, apiKey: "key-two" });
});

describe("rotateEncryptionKey", () => {
  it("re-encrypts every key and keeps the old key as .previous", async () => {
    expect(await rotateEncryptionKey(db, cfg(), {})).toEqual({ rotated: 2 });
    expect(readKey().equals(oldKey)).toBe(false);
    expect(readKey(".previous").equals(oldKey)).toBe(true);
    expect(existsSync(file(".next"))).toBe(false);
    expect(statSync(file()).mode & 0o777).toBe(0o600);
    expect(await plaintexts(readKey())).toEqual(["key-one", "key-two"]);
  });
  it("refuses when the key comes from the environment", async () => {
    await expect(
      rotateEncryptionKey(db, cfg(), { APP_ENCRYPTION_KEY: oldKey.toString("base64") }),
    ).rejects.toThrow(/environment/);
    expect(existsSync(file(".next"))).toBe(false);
  });
  it("finishes after a crash before the database commit (Review Focus 1)", async () => {
    const next = writeNext();
    expect(await rotateEncryptionKey(db, cfg(), {})).toEqual({ rotated: 2 });
    expect(readKey().equals(next)).toBe(true);
    expect(await plaintexts(next)).toEqual(["key-one", "key-two"]);
  });
  it("stays readable after a crash between commit and file swap, then finishes (Review Focus 1)", async () => {
    const next = writeNext();
    for (const r of await rows()) {
      const plain = decryptSecret({ current: oldKey, others: [] }, r.encryptedKey ?? "", r.id);
      await db
        .update(schema.providerConfigs)
        .set({ encryptedKey: encryptSecret({ current: next, others: [] }, plain, r.id) })
        .where(eq(schema.providerConfigs.id, r.id));
    }
    const running = loadKeyring(cfg()); // a process still holding the old key
    for (const r of await rows())
      expect(() => decryptSecret(running, r.encryptedKey ?? "", r.id)).not.toThrow();
    expect(await rotateEncryptionKey(db, cfg(), {})).toEqual({ rotated: 2 });
    expect(readKey().equals(next)).toBe(true);
    expect(await plaintexts(next)).toEqual(["key-one", "key-two"]);
  });
  it("aborts without changes when a stored key cannot be decrypted", async () => {
    await insertConfig(db, testConfig({ appEncryptionKey: randomBytes(32) }), { userId: "u1" });
    const before = await rows();
    await expect(rotateEncryptionKey(db, cfg(), {})).rejects.toThrow(/cannot be decrypted/);
    expect(await rows()).toEqual(before);
    expect(readKey().equals(oldKey)).toBe(true);
    expect(existsSync(file(".next"))).toBe(false);
  });
});
