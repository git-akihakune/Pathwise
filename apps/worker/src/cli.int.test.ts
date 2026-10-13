import { randomBytes } from "node:crypto";
import { createCredentialUser } from "@pathwise/core/auth";
import { schema } from "@pathwise/core/db";
import { afterEach, beforeEach, expect, inject, it, vi } from "vitest";
import { getTestDb, resetDb } from "../../../test/integration/db";
import { runCli } from "./cli";

const capture = () => {
  const lines: string[] = [];
  return { lines, io: { out: (s: string) => lines.push(s), err: (s: string) => lines.push(s) } };
};

beforeEach(async () => {
  await resetDb(getTestDb());
  vi.stubEnv("DATABASE_URL", inject("databaseUrl"));
  vi.stubEnv("APP_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
  vi.stubEnv("BETTER_AUTH_SECRET", "x".repeat(44));
});
afterEach(() => vi.unstubAllEnvs());

it("seed demo prints the password once, then points at reset-password", async () => {
  const first = capture();
  expect(await runCli(["seed", "demo"], first.io)).toBe(0);
  expect(first.lines).toHaveLength(2);
  expect(first.lines[0]).toBe("Demo user created: demo@pathwise.local");
  expect(first.lines[1]).toMatch(/^Password: [A-Za-z0-9_-]{20}$/);
  const second = capture();
  expect(await runCli(["seed", "demo"], second.io)).toBe(0);
  expect(second.lines).toEqual([
    "Demo user already exists: demo@pathwise.local. To sign in, run: pathwise admin reset-password demo@pathwise.local",
  ]);
});

it("seed demo honours --email and reports the normalized email", async () => {
  const c = capture();
  expect(await runCli(["seed", "demo", "--email", "Show@example.com"], c.io)).toBe(0);
  expect(c.lines[0]).toBe("Demo user created: show@example.com");
});

it("seed demo reports an email collision without changing the existing account", async () => {
  await createCredentialUser(getTestDb(), {
    name: "Existing user",
    email: "demo@pathwise.local",
    role: "user",
  });
  const before = await getTestDb().select().from(schema.user);
  const accounts = await getTestDb().select().from(schema.account);
  const c = capture();
  expect(await runCli(["seed", "demo"], c.io)).toBe(1);
  expect(c.lines).toEqual([
    "Seed email already exists without an active plan. Use a different email.",
  ]);
  expect(await getTestDb().select().from(schema.user)).toEqual(before);
  expect(await getTestDb().select().from(schema.account)).toEqual(accounts);
});
