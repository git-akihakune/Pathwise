"use server";

import { createRateLimiter, signUp } from "@pathwise/core/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getServer } from "@/lib/server";
import { SIGN_UP_ERRORS } from "./errors";

// `values` repopulates the fields, since React resets uncontrolled forms after every action.
export type FormState = { error?: string; values?: { name?: string; email?: string } } | undefined;

const RATE_LIMITED = "Too many attempts. Try again in a minute.";
// Better Auth only rate-limits HTTP requests, not the direct auth.api calls made here.
const signInLimiter = createRateLimiter({ limit: 10, windowMs: 60_000 });
const signUpLimiter = createRateLimiter({ limit: 10, windowMs: 60_000 });

function limited(limiter: ReturnType<typeof createRateLimiter>, h: Headers): boolean {
  if (process.env.NODE_ENV === "test") return false;
  const ip =
    h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip")?.trim() || "unknown";
  return !limiter.allow(ip);
}

function field(formData: FormData, name: string): string {
  const v = formData.get(name);
  return typeof v === "string" ? v : "";
}

export async function signUpAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const h = await headers();
  if (limited(signUpLimiter, h)) return { error: RATE_LIMITED };
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
  if (limited(signInLimiter, h)) return { error: RATE_LIMITED };
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
  redirect("/");
}

export async function signOutAction(): Promise<void> {
  await getServer().auth.api.signOut({ headers: await headers() });
  redirect("/sign-in");
}
