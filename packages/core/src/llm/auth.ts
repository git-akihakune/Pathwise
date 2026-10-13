import { APICallError, RetryError } from "ai";
import { eq, sql } from "drizzle-orm";
import { type Db, schema } from "../db";

const isDenied = (e: unknown) =>
  APICallError.isInstance(e) && (e.statusCode === 401 || e.statusCode === 403);

/** True for a 401/403 API error, directly or as the last error of an exhausted retry. */
export function isAuthError(e: unknown): boolean {
  return isDenied(e) || (RetryError.isInstance(e) && isDenied(e.lastError));
}

export async function markAuthFailed(db: Db, providerConfigId: string): Promise<void> {
  await db
    .update(schema.providerConfigs)
    .set({ status: "degraded", authFailed: true, updatedAt: sql`now()` })
    .where(eq(schema.providerConfigs.id, providerConfigId));
}

/** True when the provider answered with an API error (any status). */
export function isProviderError(e: unknown): boolean {
  return (
    APICallError.isInstance(e) || (RetryError.isInstance(e) && APICallError.isInstance(e.lastError))
  );
}
