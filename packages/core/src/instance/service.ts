import { eq } from "drizzle-orm";
import { type Db, schema } from "../db";

export type SignupMode = "open" | "invite_only" | "closed";

export interface InstanceSettings {
  signupMode: SignupMode;
  updatedAt: Date;
}

export async function ensureInstanceSettings(db: Db): Promise<void> {
  await db.insert(schema.instanceSettings).values({ id: 1 }).onConflictDoNothing();
}

export async function getInstanceSettings(db: Db): Promise<InstanceSettings> {
  const [row] = await db
    .select()
    .from(schema.instanceSettings)
    .where(eq(schema.instanceSettings.id, 1));
  if (!row) throw new Error("instance_settings row is missing; run ensureInstanceSettings first");
  return { signupMode: row.signupMode as SignupMode, updatedAt: row.updatedAt };
}
