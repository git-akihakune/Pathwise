import { expect, it } from "vitest";
import { createRateLimiter } from "./rate-limit";

it("blocks after the limit within a window, isolates keys, and resets afterwards", () => {
  const limiter = createRateLimiter({ limit: 2, windowMs: 1000 });
  expect(limiter.allow("a", 0)).toBe(true);
  expect(limiter.allow("a", 100)).toBe(true);
  expect(limiter.allow("a", 200)).toBe(false);
  expect(limiter.allow("b", 200)).toBe(true);
  expect(limiter.allow("a", 999)).toBe(false);
  expect(limiter.allow("a", 1000)).toBe(true);
});

it("evicts expired keys on the next sweep", () => {
  const limiter = createRateLimiter({ limit: 1, windowMs: 1000 });
  limiter.allow("a", 0);
  limiter.allow("b", 10);
  expect(limiter.size()).toBe(2);
  limiter.allow("c", 1500);
  expect(limiter.size()).toBe(1);
});
