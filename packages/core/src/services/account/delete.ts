import { rm } from "node:fs/promises";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { ADMIN_LOCK_KEY, countAdmins, normalizeEmail } from "../../auth";
import type { AppConfig } from "../../config";
import { type Db, schema } from "../../db";
import { NotFoundError, ValidationError } from "../../errors";
import type { JobAdmin } from "../../jobs";
import { createLogger } from "../../logger";

export { ADMIN_LOCK_KEY } from "../../auth";

export interface AccountDeps {
  db: Db;
  config: Pick<AppConfig, "filesDir">;
  jobs: Pick<JobAdmin, "cancelUserJobs">;
}
export type DeleteAccountResult =
  | { ok: true; cancelledJobs: number }
  | { ok: false; reason: "email_mismatch" | "last_admin" };

const log = createLogger("account");

export async function deleteAccount(
  deps: AccountDeps,
  userId: string,
  input: { confirmEmail: string },
): Promise<DeleteAccountResult> {
  // Validate before committing so an unsafe path can never leave a half-deleted account.
  if (!/^[\w-]+$/.test(userId)) throw new ValidationError("Invalid user ID.");
  const result = await deps.db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${ADMIN_LOCK_KEY})`);
    const [user] = await tx
      .select({ email: schema.user.email, role: schema.user.role })
      .from(schema.user)
      .where(eq(schema.user.id, userId));
    if (!user) throw new NotFoundError("Account not found.");
    if (normalizeEmail(input.confirmEmail) !== user.email) {
      return { ok: false, reason: "email_mismatch" } as const;
    }
    if (user.role === "admin" && (await countAdmins(tx)) === 1) {
      return { ok: false, reason: "last_admin" } as const;
    }
    await tx.delete(schema.user).where(eq(schema.user.id, userId));
    return { ok: true } as const;
  });
  if (!result.ok) return result;

  let cancelledJobs: number;
  try {
    cancelledJobs = await deps.jobs.cancelUserJobs(userId);
  } finally {
    await rm(join(deps.config.filesDir, userId), { recursive: true, force: true });
  }
  log.info({ userId, cancelledJobs }, "account deleted");
  return { ok: true, cancelledJobs };
}
