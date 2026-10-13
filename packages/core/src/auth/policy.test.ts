import { describe, expect, it } from "vitest";
import { evaluateSignup } from "./policy";

describe("evaluateSignup", () => {
  it.each([
    [
      { adminCount: 0, mode: "closed", invite: "none" },
      { allowed: true, role: "admin" },
    ],
    [
      { adminCount: 0, mode: "invite_only", invite: "invalid" },
      { allowed: true, role: "admin" },
    ],
    [
      { adminCount: 3, mode: "open", invite: "none" },
      { allowed: true, role: "user" },
    ],
    [
      { adminCount: 3, mode: "invite_only", invite: "none" },
      { allowed: false, reason: "invite_required" },
    ],
    [
      { adminCount: 3, mode: "invite_only", invite: "invalid" },
      { allowed: false, reason: "invite_invalid" },
    ],
    [
      { adminCount: 3, mode: "invite_only", invite: "valid" },
      { allowed: true, role: "user" },
    ],
    [
      { adminCount: 3, mode: "closed", invite: "valid" },
      { allowed: false, reason: "closed" },
    ],
  ] as const)("%o → %o", (input, expected) => {
    expect(evaluateSignup(input)).toEqual(expected);
  });
});
