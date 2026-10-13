import { APICallError, RetryError } from "ai";
import { expect, it } from "vitest";
import { isAuthError, isProviderError } from "./auth";

const apiError = (statusCode: number) =>
  new APICallError({ message: "x", url: "u", requestBodyValues: {}, statusCode });

it("recognises provider errors, directly or as an exhausted retry", () => {
  expect(isProviderError(apiError(500))).toBe(true);
  expect(
    isProviderError(
      new RetryError({ message: "x", reason: "maxRetriesExceeded", errors: [apiError(503)] }),
    ),
  ).toBe(true);
  expect(isProviderError(new Error("boom"))).toBe(false);
  expect(isAuthError(apiError(500))).toBe(false);
});
