import { expect, it } from "vitest";
import { redactText, resultJson } from "./run";

it("redacts raw and trimmed credentials from logs and every JSON value and key", () => {
  const secret = '  secret-"token"  ';
  const value = {
    [secret]: { transcript: `provider returned ${secret.trim()}`, error: `failed ${secret}` },
  };
  const json = resultJson(value, [secret]);
  expect(json).not.toContain("secret-");
  expect(JSON.parse(json)).toEqual({
    "[redacted]": { transcript: "provider returned [redacted]", error: "failed [redacted]" },
  });
  expect(redactText(`error ${secret.trim()} and ${secret}`, [secret])).toBe(
    "error [redacted] and [redacted]",
  );
});
