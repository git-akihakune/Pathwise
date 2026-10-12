import { APICallError, RetryError } from "ai";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { isAuthError } from "./auth";
import { parseJsonReply } from "./generate";

const Person = z.object({ name: z.string(), years: z.number().int() });
const apiError = (statusCode: number) =>
  new APICallError({
    message: "x",
    url: "https://api.example",
    requestBodyValues: {},
    statusCode,
  });

describe("parseJsonReply", () => {
  it.each([
    '{"name":"Ada","years":3}',
    '```json\n{"name":"Ada","years":3}\n```',
    'Sure! Here it is:\n{"name":"Ada","years":3}\nHope that helps.',
  ])("accepts %j", (text) =>
    expect(parseJsonReply(text, Person)).toEqual({
      ok: true,
      value: { name: "Ada", years: 3 },
    }),
  );
  it("reports Zod issues with their paths, and invalid JSON", () => {
    expect(parseJsonReply('{"name":"Ada","years":2.5}', Person)).toEqual({
      ok: false,
      issues: [expect.stringMatching(/^years: /)],
    });
    expect(parseJsonReply("{name: Ada", Person)).toEqual({
      ok: false,
      issues: [expect.stringMatching(/^Reply is not valid JSON/)],
    });
  });
});

it("isAuthError recognises 401 and 403, directly or as a retry's last error", () => {
  expect(isAuthError(apiError(401))).toBe(true);
  expect(isAuthError(apiError(403))).toBe(true);
  expect(
    isAuthError(
      new RetryError({ message: "r", reason: "maxRetriesExceeded", errors: [apiError(401)] }),
    ),
  ).toBe(true);
  expect(isAuthError(apiError(429))).toBe(false);
  expect(isAuthError(new Error("401"))).toBe(false);
});
