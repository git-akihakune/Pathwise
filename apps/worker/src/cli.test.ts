import { expect, it } from "vitest";
import { runCli } from "./cli";

const io = () => {
  const out: string[] = [];
  return { out, io: { out: (s: string) => out.push(s), err: (s: string) => out.push(s) } };
};
it("prints usage and exits 2 for unknown commands", async () => {
  const { out, io: sink } = io();
  expect(await runCli(["frobnicate"], sink)).toBe(2);
  expect(out.join("\n")).toMatch(/admin reset-password <email>/);
  expect(out.join("\n")).toMatch(/admin rotate-encryption-key/);
  expect(out.join("\n")).toMatch(/checkin start <email>/);
  expect(out.join("\n")).toMatch(/seed demo \[--email <email>\]/);
  expect(out.join("\n")).toMatch(/healthcheck/);
});
it.each([
  ["seed"],
  ["seed", "other"],
  ["seed", "demo", "--email"],
  ["seed", "demo", "--unknown", "x@example.com"],
  ["seed", "demo", "--email", "x@example.com", "extra"],
  ["seed", "demo", "extra"],
])("rejects incomplete or unknown seed arguments: %j", async (...args) => {
  const { out, io: sink } = io();
  expect(await runCli(args, sink)).toBe(2);
  expect(out.join("\n")).toContain("Usage: pathwise <command>");
});
it("healthcheck exits 1 when the heartbeat is missing", async () => {
  expect(await runCli(["healthcheck"], io().io)).toBe(1);
});
