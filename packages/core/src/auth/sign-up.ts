import { APIError } from "better-auth/api";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { type Db, schema } from "../db";
import { normalizeEmail } from "../invites";
import { type Auth, MIN_PASSWORD_LENGTH } from "./create-auth";
import type { SignupRejection } from "./policy";
import { runInSignupContext } from "./signup-context";

export type SignUpInput = { name: string; email: string; password: string; inviteToken?: string };
export type SignUpFailure = SignupRejection | "email_taken" | "weak_password" | "invalid_input";
export type SignUpResult =
  | { ok: true; userId: string; role: "admin" | "user" }
  | { ok: false; reason: SignUpFailure };

const SIGNUP_LOCK_KEY = 0x50415448;

const inputSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.email(),
  password: z.string(),
});

const REJECTIONS: readonly string[] = ["closed", "invite_required", "invite_invalid"];

// In-process queue: the advisory-lock transaction holds a pool connection while Better Auth
// needs others, so unbounded concurrent sign-ups could exhaust the pool and deadlock.
let queue: Promise<unknown> = Promise.resolve();
function serialise<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
}

function mapError(e: unknown): SignUpFailure | null {
  if (!(e instanceof APIError)) return null;
  const body = e.body as { message?: string; code?: string } | undefined;
  if (body?.message && REJECTIONS.includes(body.message)) return body.message as SignupRejection;
  if (
    body?.code === "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL" ||
    body?.code === "USER_ALREADY_EXISTS"
  ) {
    return "email_taken";
  }
  if (body?.code === "PASSWORD_TOO_SHORT" || body?.code === "PASSWORD_TOO_LONG")
    return "weak_password";
  return null;
}

/** The only sanctioned sign-up path: enforces the sign-up policy, serialised per instance. */
export async function signUp(
  deps: { auth: Auth; db: Db },
  input: SignUpInput,
  headers?: Headers,
): Promise<SignUpResult> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid_input" };
  if (parsed.data.password.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, reason: "weak_password" };
  }
  const { name, email, password } = parsed.data;
  const { auth, db } = deps;

  return serialise(async () => {
    try {
      const userId = await db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(${SIGNUP_LOCK_KEY})`);
        const res = await runInSignupContext({ inviteToken: input.inviteToken }, () =>
          auth.api.signUpEmail({
            body: { name, email: normalizeEmail(email), password },
            headers,
          }),
        );
        return res.user.id;
      });
      const [row] = await db
        .select({ role: schema.user.role })
        .from(schema.user)
        .where(eq(schema.user.id, userId));
      return { ok: true, userId, role: row?.role === "admin" ? "admin" : "user" } as const;
    } catch (e) {
      const reason = mapError(e);
      if (reason) return { ok: false, reason } as const;
      throw e;
    }
  });
}
