export const DELETE_ACCOUNT_ERRORS: Record<"email_mismatch" | "last_admin", string> = {
  email_mismatch: "That email doesn't match your account.",
  last_admin: "You're the only admin. Promote another admin first.",
};
