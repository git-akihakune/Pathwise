import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { loadKeyring } from "./keyring";

const k = (n: number) => Buffer.alloc(32, n);
const dir = () => mkdtempSync(join(tmpdir(), "pw-ring-"));
const put = (d: string, name: string, v: string) =>
  writeFileSync(join(d, name), v, { mode: 0o600 });

it("holds only the current key when no key files exist", () => {
  expect(loadKeyring({ appEncryptionKey: k(1), secretsDir: dir() })).toEqual({
    current: k(1),
    others: [],
  });
});
it("adds distinct keys from APP_ENCRYPTION_KEY, .next and .previous, in that order", () => {
  const d = dir();
  put(d, "APP_ENCRYPTION_KEY", k(1).toString("base64"));
  put(d, "APP_ENCRYPTION_KEY.next", k(2).toString("base64"));
  put(d, "APP_ENCRYPTION_KEY.previous", k(3).toString("base64"));
  expect(loadKeyring({ appEncryptionKey: k(1), secretsDir: d })).toEqual({
    current: k(1),
    others: [k(2), k(3)],
  });
  // A process started before a rotation swapped the files still reads every key.
  expect(loadKeyring({ appEncryptionKey: k(3), secretsDir: d }).others).toEqual([k(1), k(2)]);
});
it("fails loudly on a corrupt key file", () => {
  const d = dir();
  put(d, "APP_ENCRYPTION_KEY.next", "short");
  expect(() => loadKeyring({ appEncryptionKey: k(1), secretsDir: d })).toThrow(
    /APP_ENCRYPTION_KEY\.next/,
  );
});
