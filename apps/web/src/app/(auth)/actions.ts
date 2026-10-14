"use server";

import { createRateLimiter, MIN_PASSWORD_LENGTH, signUp } from "@pathwise/core/auth";
import { normalizeEmail } from "@pathwise/core/invites";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { safeNext } from "@/lib/safe-next";
import { getServer } from "@/lib/server";
import { SIGN_UP_ERRORS } from "./errors";

// `values` repopulates the fields, since React resets uncontrolled forms after every action.
export type FormState =
  | { error?: string; sent?: boolean; values?: { name?: string; email?: string } }
  | undefined;

const RATE_LIMITED = "Too many attempts. Try again in a minute.";
// Better Auth only rate-limits HTTP requests, not the direct auth.api calls made here.
const signInLimiter = createRateLimiter({ limit: 10, windowMs: 60_000 });
const signUpLimiter = createRateLimiter({ limit: 10, windowMs: 60_000 });
const resetLimiter = createRateLimiter({ limit: 5, windowMs: 60_000 });

// The IP bucket is best-effort only: without a trusted proxy x-forwarded-for is client-controlled
// and spoofable. The per-email bucket is the real per-account bound on guessing.
function limited(
  limiter: ReturnType<typeof createRateLimiter>,
  h: Headers,
  email: string,
): boolean {
  if (process.env.NODE_ENV === "test") return false;
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip")?.trim();
  const ipOk = ip ? limiter.allow(`ip:${ip}`) : true;
  const emailOk = limiter.allow(`email:${normalizeEmail(email)}`);
  return !(ipOk && emailOk);
}

function field(formData: FormData, name: string): string {
  const v = formData.get(name);
  return typeof v === "string" ? v : "";
}

export async function signUpAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const h = await headers();
  if (limited(signUpLimiter, h, field(formData, "email"))) return { error: RATE_LIMITED };
  const result = await signUp(
    getServer(),
    {
      name: field(formData, "name").trim(),
      email: field(formData, "email").trim(),
      password: field(formData, "password"),
      inviteToken: field(formData, "inviteToken") || undefined,
    },
    h,
  );
  if (!result.ok) {
    return {
      error: SIGN_UP_ERRORS[result.reason],
      values: { name: field(formData, "name"), email: field(formData, "email") },
    };
  }
  redirect("/");
}

export async function signInAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const h = await headers();
  if (limited(signInLimiter, h, field(formData, "email"))) return { error: RATE_LIMITED };
  try {
    await getServer().auth.api.signInEmail({
      body: { email: field(formData, "email").trim(), password: field(formData, "password") },
      headers: h,
    });
  } catch {
    return {
      error: "Email or password is incorrect.",
      values: { email: field(formData, "email") },
    };
  }
  redirect(safeNext(field(formData, "next")));
}

export async function forgotPasswordAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const h = await headers();
  const email = field(formData, "email").trim();
  if (limited(resetLimiter, h, email)) return { error: RATE_LIMITED };
  const { auth, mailer } = getServer();
  // Same answer whether or not the account exists (and whether or not the send worked).
  if (mailer.enabled) {
    try {
      await auth.api.requestPasswordReset({ body: { email, redirectTo: "/reset-password" } });
    } catch {}
  }
  return { sent: true };
}

export async function resetPasswordAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const password = field(formData, "password");
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { error: `Use at least ${MIN_PASSWORD_LENGTH} characters.` };
  }
  try {
    await getServer().auth.api.resetPassword({
      body: { token: field(formData, "token"), newPassword: password },
    });
  } catch {
    return { error: "This reset link has expired or was already used." };
  }
  redirect("/sign-in?reset=1");
}

export async function signOutAction(): Promise<void> {
  await getServer().auth.api.signOut({ headers: await headers() });
  redirect("/sign-in");
}
