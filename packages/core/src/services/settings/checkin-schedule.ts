import { eq } from "drizzle-orm";
import { type DbOrTx, schema } from "../../db";
import { ValidationError } from "../../errors";
import { getUserSettings, type UserSettings } from "./service";

export interface CheckinScheduleInput {
  enabled: boolean;
  /** 0 = Sunday … 6 = Saturday. */
  day: number;
  /** HH:MM, 00:00–23:59. */
  time: string;
  emailEnabled: boolean;
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export async function updateCheckinSchedule(
  db: DbOrTx,
  userId: string,
  input: CheckinScheduleInput,
): Promise<{ before: UserSettings; after: UserSettings }> {
  if (
    !(Number.isInteger(input.day) && input.day >= 0 && input.day <= 6) ||
    !TIME.test(input.time)
  ) {
    throw new ValidationError("Choose a day and a time between 00:00 and 23:59.");
  }
  const before = await getUserSettings(db, userId);
  await db
    .update(schema.userSettings)
    .set({
      checkinEnabled: input.enabled,
      checkinDay: input.day,
      checkinTime: input.time,
      emailEnabled: input.emailEnabled,
      updatedAt: new Date(),
    })
    .where(eq(schema.userSettings.userId, userId));
  return { before, after: await getUserSettings(db, userId) };
}
