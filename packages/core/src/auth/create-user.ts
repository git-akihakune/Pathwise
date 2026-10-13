import { randomBytes, randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { type DbOrTx, schema } from "../db";
import { normalizeEmail } from "../invites";

/** Bypasses sign-up policy: only for seeds, evals and smoke tests. */
export async function createCredentialUser(
  db: DbOrTx,
  input: { name: string; email: string; role: "admin" | "user"; emailVerified?: boolean },
): Promise<{ userId: string; password: string }> {
  const userId = randomUUID();
  const password = randomBytes(15).toString("base64url");
  const passwordHash = await hashPassword(password);
  await db.transaction(async (tx) => {
    await tx.insert(schema.user).values({
      id: userId,
      name: input.name,
      email: normalizeEmail(input.email),
      role: input.role,
      emailVerified: input.emailVerified ?? true,
    });
    await tx.insert(schema.account).values({
      id: randomUUID(),
      accountId: userId,
      userId,
      providerId: "credential",
      password: passwordHash,
      updatedAt: new Date(),
    });
  });
  return { userId, password };
}
