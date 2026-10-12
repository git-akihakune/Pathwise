import { type BetterAuthPlugin, betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { admin } from "better-auth/plugins";
import { eq } from "drizzle-orm";
import type { AppConfig } from "../config";
import { type Db, schema } from "../db";
import { getInstanceSettings } from "../instance";
import { findUsableInvite, markInviteUsed, normalizeEmail } from "../invites";
import { evaluateSignup, type InviteCheck } from "./policy";
import { getSignupContext } from "./signup-context";

export const MIN_PASSWORD_LENGTH = 12;

export async function countUsers(db: Db): Promise<number> {
  return db.$count(schema.user);
}

export async function userExists(db: Db, email: string): Promise<boolean> {
  return (await db.$count(schema.user, eq(schema.user.email, normalizeEmail(email)))) > 0;
}

export function createAuth(deps: {
  db: Db;
  config: Pick<AppConfig, "appUrl" | "betterAuthSecret">;
  plugins?: BetterAuthPlugin[];
}) {
  const { db, config } = deps;
  return betterAuth({
    baseURL: config.appUrl,
    secret: config.betterAuthSecret,
    trustedOrigins: [config.appUrl],
    // Sign-in/up go through the app's server actions (rate limits, sign-up policy); this only
    // closes the public HTTP routes, direct auth.api calls are unaffected.
    disabledPaths: ["/sign-in/email", "/sign-up/email"],
    database: drizzleAdapter(db, { provider: "pg", schema }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: MIN_PASSWORD_LENGTH,
      autoSignIn: true,
    },
    rateLimit: { enabled: process.env.NODE_ENV !== "test", storage: "memory" },
    plugins: [admin({ defaultRole: "user" }), ...(deps.plugins ?? [])],
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            const ctx = getSignupContext();
            if (!ctx) {
              throw new APIError("FORBIDDEN", { message: "Sign-up must go through the app" });
            }
            let invite: InviteCheck = "none";
            let inviteId: string | undefined;
            if (ctx.inviteToken) {
              const found = await findUsableInvite(db, ctx.inviteToken, user.email);
              invite = found ? "valid" : "invalid";
              inviteId = found?.id;
            }
            const decision = evaluateSignup({
              userCount: await countUsers(db),
              mode: (await getInstanceSettings(db)).signupMode,
              invite,
            });
            if (!decision.allowed) throw new APIError("FORBIDDEN", { message: decision.reason });
            ctx.inviteId = inviteId;
            return { data: { ...user, role: decision.role } };
          },
          after: async (user) => {
            const inviteId = getSignupContext()?.inviteId;
            if (inviteId) await markInviteUsed(db, inviteId, user.id);
          },
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
