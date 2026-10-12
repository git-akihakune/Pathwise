import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadSecrets } from "./env";
import { ensureSecrets } from "./secrets";

const fresh = () => join(mkdtempSync(join(tmpdir(), "pw-")), "secrets"); // dir does not exist yet

describe("ensureSecrets", () => {
  it("creates both secrets with mode 0600 and 32 random bytes", async () => {
    const dir = fresh();
    expect(await ensureSecrets(dir, {})).toEqual({
      generated: ["APP_ENCRYPTION_KEY", "BETTER_AUTH_SECRET"],
    });
    for (const name of ["APP_ENCRYPTION_KEY", "BETTER_AUTH_SECRET"]) {
      const path = join(dir, name);
      expect(statSync(path).mode & 0o777).toBe(0o600);
      expect(Buffer.from(readFileSync(path, "utf8").trim(), "base64").length).toBe(32);
    }
    expect(() => loadSecrets({}, dir)).not.toThrow();
  });
  it("is idempotent and never rewrites existing secrets", async () => {
    const dir = fresh();
    await ensureSecrets(dir, {});
    const before = readFileSync(join(dir, "APP_ENCRYPTION_KEY"), "utf8");
    expect(await ensureSecrets(dir, {})).toEqual({ generated: [] });
    expect(readFileSync(join(dir, "APP_ENCRYPTION_KEY"), "utf8")).toBe(before);
  });
  it("skips secrets provided via env", async () => {
    const dir = fresh();
    expect(await ensureSecrets(dir, { BETTER_AUTH_SECRET: "from-env" })).toEqual({
      generated: ["APP_ENCRYPTION_KEY"],
    });
    expect(existsSync(join(dir, "BETTER_AUTH_SECRET"))).toBe(false);
  });
  it("refuses to overwrite a corrupt secret file (Review Focus 4)", async () => {
    const dir = fresh();
    await ensureSecrets(dir, {});
    writeFileSync(join(dir, "APP_ENCRYPTION_KEY"), "truncated");
    await expect(ensureSecrets(dir, {})).rejects.toThrow(/refusing to overwrite/);
    expect(readFileSync(join(dir, "APP_ENCRYPTION_KEY"), "utf8")).toBe("truncated");
  });
  it("reports unreadable secret files as read errors, not invalid content", async () => {
    const dir = fresh();
    await ensureSecrets(dir, {});
    rmSync(join(dir, "BETTER_AUTH_SECRET"));
    mkdirSync(join(dir, "BETTER_AUTH_SECRET"));
    const err = await ensureSecrets(dir, {}).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/could not be read \(EISDIR\)/);
    expect((err as Error).message).not.toMatch(/remove/);
  });
  it("refuses to overwrite an empty secret file", async () => {
    const dir = fresh();
    await ensureSecrets(dir, {});
    writeFileSync(join(dir, "BETTER_AUTH_SECRET"), "  \n");
    await expect(ensureSecrets(dir, {})).rejects.toThrow(/refusing to overwrite/);
  });
});
