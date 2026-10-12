import { randomBytes } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { and, eq } from "drizzle-orm";
import { type Db, schema } from "../db";
import { NotFoundError } from "../errors";
import { normalizeEmail } from "../invites";

/** Operator-only: sets a fresh random password on the user's credential account and returns it. */
export async function resetPassword(db: Db, email: string): Promise<string> {
  const [row] = await db
    .select({ accountId: schema.account.id })
    .from(schema.account)
    .innerJoin(schema.user, eq(schema.user.id, schema.account.userId))
    .where(
      and(
        eq(schema.user.email, normalizeEmail(email)),
        eq(schema.account.providerId, "credential"),
      ),
    );
  if (!row) throw new NotFoundError(`No password account found for ${email}`);
  const password = randomBytes(15).toString("base64url");
  await db
    .update(schema.account)
    .set({ password: await hashPassword(password) })
    .where(eq(schema.account.id, row.accountId));
  return password;
}
