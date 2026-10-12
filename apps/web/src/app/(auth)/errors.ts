import type { SignUpFailure } from "@pathwise/core/auth";

// Lives outside actions.ts because a "use server" file may only export async functions.
export const SIGN_UP_ERRORS: Record<SignUpFailure, string> = {
  closed: "Sign-up on this instance is closed.",
  invite_required: "Sign-up on this instance is by invitation.",
  invite_invalid: "This invitation is no longer valid. Ask your admin for a new one.",
  email_taken: "An account with this email already exists.",
  weak_password: "Use between 12 and 128 characters.",
  invalid_input: "Check your name and email address.",
};
