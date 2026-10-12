import { APICallError } from "ai";
import { expect, it } from "vitest";
import { chatErrorMessage, isContextLengthError } from "./errors";

const api = (statusCode: number, message: string) =>
  new APICallError({ message, url: "x", requestBodyValues: {}, statusCode, isRetryable: false });
it.each([
  "This model's maximum context length is 8192 tokens",
  "prompt is too long: 210000 tokens > 200000 maximum",
  "the request exceeds the available context size, try increasing it",
  "The input token count (40000) exceeds the maximum number of tokens allowed (32768).",
])("detects context-length errors: %s", (m) =>
  expect(isContextLengthError(api(400, m))).toBe(true),
);
it("ignores other 400s", () =>
  expect(isContextLengthError(api(400, "invalid tool schema"))).toBe(false));
it.each([
  [api(429, "rate"), "The AI provider is rate-limiting requests. Wait a moment and retry."],
  [api(503, "down"), "The AI provider had a problem. Retry in a moment."],
  [api(401, "bad key"), "Your API key was rejected. Update it in Settings."],
  [new Error("boom"), "Something went wrong. Retry in a moment."],
] as const)("maps %o to user copy", (e, copy) => expect(chatErrorMessage(e)).toBe(copy));
it("suggests a new session after the context retry failed", () =>
  expect(
    chatErrorMessage(api(400, "maximum context length is 8192"), { afterContextRetry: true }),
  ).toBe("This conversation is too long for the model. Start a new session to continue."));
