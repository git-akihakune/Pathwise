"use server";

import { ValidationError } from "@pathwise/core/errors";
import { getUserSettings, updateUserSettings } from "@pathwise/core/services/settings";
import { revalidatePath } from "next/cache";
import { getServer } from "@/lib/server";
import { requireSession } from "@/lib/session";

/** Stores the browser's timezone, but only while the user has none; never overwrites a chosen zone. */
export async function saveDetectedTimezoneAction(tz: string): Promise<void> {
  const { userId } = await requireSession();
  const { db } = getServer();
  if ((await getUserSettings(db, userId)).timezone !== null) return;
  try {
    await updateUserSettings(db, userId, { timezone: tz });
  } catch (e) {
    if (e instanceof ValidationError) return;
    throw e;
  }
  revalidatePath("/", "layout");
}
