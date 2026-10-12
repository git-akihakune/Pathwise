import { sql } from "drizzle-orm";
import { type DbOrTx, schema } from "../../db";

/** Marks the profile as changed (upserting `user_settings`) so cached summaries can be rebuilt. */
export async function bumpProfileVersion(db: DbOrTx, userId: string): Promise<void> {
  await db
    .insert(schema.userSettings)
    .values({ userId, profileVersion: 1 })
    .onConflictDoUpdate({
      target: schema.userSettings.userId,
      set: {
        profileVersion: sql`${schema.userSettings.profileVersion} + 1`,
        updatedAt: sql`now()`,
      },
    });
}
