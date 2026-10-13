import { eq } from "drizzle-orm";
import { type DbOrTx, schema } from "../../db";
import { ValidationError } from "../../errors";

export interface UserSettings {
  providerConfigId: string | null;
  bluntness: 1 | 2 | 3 | 4 | 5;
  timezone: string | null;
  checkinEnabled: boolean;
  checkinDay: number;
  checkinTime: string;
  emailEnabled: boolean;
  checkinIcsSequence: number;
  profileVersion: number;
}

// Excludes offset zones like "+01:00", which recent V8 accepts.
const TIMEZONE_SHAPE = /^[A-Za-z]+(?:\/[A-Za-z0-9_+-]+)*$/;

function isValidTimezone(timeZone: string): boolean {
  if (!TIMEZONE_SHAPE.test(timeZone)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

function toSettings(row: typeof schema.userSettings.$inferSelect): UserSettings {
  return {
    providerConfigId: row.providerConfigId,
    bluntness: row.bluntness as UserSettings["bluntness"],
    timezone: row.timezone,
    checkinEnabled: row.checkinEnabled,
    checkinDay: row.checkinDay,
    checkinTime: row.checkinTime,
    emailEnabled: row.emailEnabled,
    checkinIcsSequence: row.checkinIcsSequence,
    profileVersion: row.profileVersion,
  };
}

export async function getUserSettings(db: DbOrTx, userId: string): Promise<UserSettings> {
  await db.insert(schema.userSettings).values({ userId }).onConflictDoNothing();
  const [row] = await db
    .select()
    .from(schema.userSettings)
    .where(eq(schema.userSettings.userId, userId));
  if (!row) throw new Error("user_settings row missing after insert");
  return toSettings(row);
}

export async function updateUserSettings(
  db: DbOrTx,
  userId: string,
  patch: Partial<Pick<UserSettings, "bluntness" | "timezone">>,
): Promise<UserSettings> {
  if (
    patch.bluntness !== undefined &&
    !(Number.isInteger(patch.bluntness) && patch.bluntness >= 1 && patch.bluntness <= 5)
  ) {
    throw new ValidationError("Bluntness must be a whole number from 1 to 5.");
  }
  if (patch.timezone != null && !isValidTimezone(patch.timezone)) {
    throw new ValidationError("Unknown timezone.");
  }
  await getUserSettings(db, userId);
  const [row] = await db
    .update(schema.userSettings)
    .set({
      ...(patch.bluntness !== undefined && { bluntness: patch.bluntness }),
      ...(patch.timezone !== undefined && { timezone: patch.timezone }),
      updatedAt: new Date(),
    })
    .where(eq(schema.userSettings.userId, userId))
    .returning();
  if (!row) throw new Error("user_settings row missing after update");
  return toSettings(row);
}

export function effectiveTimezone(s: UserSettings): string {
  return s.timezone ?? "UTC";
}
