"use server";

import { ValidationError } from "@pathwise/core/errors";
import { setActionStatus } from "@pathwise/core/services/plan";
import { getUserSettings, updateUserSettings } from "@pathwise/core/services/settings";
import { revalidatePath } from "next/cache";
import { type FormState, runForm } from "@/lib/entity-action";
import { getServer } from "@/lib/server";
import { requireSession } from "@/lib/session";

export async function toggleActionAction(actionId: string, done: boolean): Promise<FormState> {
  const { db } = getServer();
  const result = await runForm("/", (userId) =>
    setActionStatus(db, userId, actionId, done ? "done" : "todo"),
  );
  if (!result?.error) revalidatePath("/plan");
  return result;
}

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
