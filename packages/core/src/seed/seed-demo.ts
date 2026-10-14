import { eq, sql } from "drizzle-orm";
import { createCredentialUser, normalizeEmail } from "../auth";
import { type Db, schema } from "../db";
import { ConflictError } from "../errors";
import { getActivePlan } from "../services/plan";
import { applyPersona } from "./apply";
import { DEMO_PERSONA } from "./demo-persona";

export const DEMO_EMAIL = "demo@pathwise.local";
export type SeedResult =
  | { created: true; userId: string; email: string; password: string }
  | { created: false; userId: string; email: string };

export async function seedDemo(
  deps: { db: Db },
  opts: { email?: string; now?: Date } = {},
): Promise<SeedResult> {
  const email = normalizeEmail(opts.email ?? DEMO_EMAIL);
  return deps.db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`pathwise.seed:${email}`}, 0))`,
    );
    const [existing] = await tx
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(eq(schema.user.email, email));
    if (existing) {
      if (await getActivePlan(tx, existing.id))
        return { created: false, userId: existing.id, email };
      throw new ConflictError(
        "Seed email already exists without an active plan. Use a different email.",
      );
    }
    const credentials = await createCredentialUser(tx, {
      name: DEMO_PERSONA.name,
      email,
      role: "user",
    });
    await applyPersona(tx, credentials.userId, DEMO_PERSONA, opts.now ?? new Date());
    return { created: true, ...credentials, email };
  });
}
