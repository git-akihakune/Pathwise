import type { SignupMode } from "../instance";

export type InviteCheck = "valid" | "invalid" | "none";
export type SignupRejection = "closed" | "invite_required" | "invite_invalid";
export type SignupDecision =
  | { allowed: true; role: "admin" | "user" }
  | { allowed: false; reason: SignupRejection };

/** Pure sign-up policy. The first user always becomes admin, regardless of mode. */
export function evaluateSignup(input: {
  userCount: number;
  mode: SignupMode;
  invite: InviteCheck;
}): SignupDecision {
  if (input.userCount === 0) return { allowed: true, role: "admin" };
  switch (input.mode) {
    case "open":
      return { allowed: true, role: "user" };
    case "closed":
      return { allowed: false, reason: "closed" };
    case "invite_only":
      if (input.invite === "valid") return { allowed: true, role: "user" };
      return {
        allowed: false,
        reason: input.invite === "none" ? "invite_required" : "invite_invalid",
      };
  }
}
