import { eq } from "drizzle-orm";
import { z } from "zod";
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

export interface SafetyResource {
  name: string;
  url: string;
}

const safetyResourcesSchema = z.array(z.object({ name: z.string(), url: z.string() })).min(1);

const DEFAULT_SAFETY_RESOURCES: SafetyResource[] = [
  { name: "Find a Helpline", url: "https://findahelpline.com" },
];

/** Never throws: the crisis path must work even if the row or column is missing or malformed. */
export async function getSafetyResources(db: Db): Promise<SafetyResource[]> {
  try {
    const [row] = await db
      .select({ list: schema.instanceSettings.safetyResources })
      .from(schema.instanceSettings)
      .where(eq(schema.instanceSettings.id, 1));
    const parsed = safetyResourcesSchema.safeParse(row?.list);
    return parsed.success ? parsed.data : DEFAULT_SAFETY_RESOURCES;
  } catch {
    return DEFAULT_SAFETY_RESOURCES;
  }
}
