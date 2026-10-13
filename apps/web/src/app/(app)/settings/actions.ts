"use server";

import type { ProbeChecks, ProviderStatus } from "@pathwise/core/llm";
import { createLogger } from "@pathwise/core/logger";
import { calendarAction, mailErrorFields, sendCheckinCalendar } from "@pathwise/core/mail";
import {
  activateProviderConfig,
  deleteProviderConfig,
  saveProviderConfig,
  testProviderConfig,
} from "@pathwise/core/services/providers";
import {
  getUserSettings,
  updateCheckinSchedule,
  updateUserSettings,
} from "@pathwise/core/services/settings";
import { revalidatePath } from "next/cache";
import { toFormError } from "@/lib/form-error";
import { optional, parseProviderInput, text } from "@/lib/provider-input";
import { getServer } from "@/lib/server";
import { requireSession } from "@/lib/session";

const log = createLogger("settings");

/** Emails a calendar invite or cancellation if the settings change calls for one. Never throws. */
async function syncCalendar(
  before: Parameters<typeof calendarAction>[0] & { checkinIcsSequence: number },
  after: Parameters<typeof calendarAction>[1],
  userId: string,
  explicitSave: boolean,
): Promise<boolean> {
  const { db, config, mailer } = getServer();
  if (!mailer.enabled) return false;
  const action = calendarAction(before, after, before.checkinIcsSequence, { explicitSave });
  if (!action) return false;
  try {
    await sendCheckinCalendar(
      { db, config, mailer },
      userId,
      action === "request" ? "REQUEST" : "CANCEL",
    );
    return action === "request";
  } catch (e) {
    log.error({ ...mailErrorFields(e), userId }, "calendar invite failed");
    return false;
  }
}

export type ProviderFormState =
  | {
      error?: string;
      result?: { label: string; status: ProviderStatus; checks: ProbeChecks };
    }
  | undefined;

export type CoachSettingsState = { error?: string; saved?: boolean } | undefined;
export type CheckinScheduleState =
  | { error?: string; saved?: boolean; invited?: boolean }
  | undefined;

export async function saveProviderAction(
  _prev: ProviderFormState,
  fd: FormData,
): Promise<ProviderFormState> {
  const { userId, role } = await requireSession();
  const deps = getServer();
  const actor = { userId, role };
  let configId = optional(fd, "id");
  try {
    const saved = await saveProviderConfig(deps, actor, {
      ...parseProviderInput(fd),
      scope: "user",
    });
    configId = saved.id;
    const { checks, status, label } = await testProviderConfig(deps, actor, saved.id);
    return { result: { label, status, checks } };
  } catch (e) {
    return toFormError(e, { configId });
  } finally {
    revalidatePath("/", "layout");
  }
}

export async function testProviderAction(id: string): Promise<ProviderFormState> {
  const { userId, role } = await requireSession();
  try {
    const { checks, status, label } = await testProviderConfig(getServer(), { userId, role }, id);
    return { result: { label, status, checks } };
  } catch (e) {
    return toFormError(e, { configId: id });
  } finally {
    revalidatePath("/", "layout");
  }
}

export async function activateProviderAction(id: string): Promise<ProviderFormState> {
  const { userId } = await requireSession();
  try {
    await activateProviderConfig(getServer().db, userId, id);
    return undefined;
  } catch (e) {
    return toFormError(e, { configId: id });
  } finally {
    revalidatePath("/", "layout");
  }
}

export async function deleteProviderAction(id: string): Promise<ProviderFormState> {
  const { userId } = await requireSession();
  try {
    await deleteProviderConfig(getServer().db, userId, id);
    return undefined;
  } catch (e) {
    return toFormError(e, { configId: id });
  } finally {
    revalidatePath("/", "layout");
  }
}

export async function saveCoachSettingsAction(
  _prev: CoachSettingsState,
  fd: FormData,
): Promise<CoachSettingsState> {
  const { userId } = await requireSession();
  try {
    const { db } = getServer();
    const before = await getUserSettings(db, userId);
    const after = await updateUserSettings(db, userId, {
      bluntness: Number(fd.get("bluntness")) as 1 | 2 | 3 | 4 | 5,
      timezone: text(fd, "timezone") || null,
    });
    await syncCalendar(before, after, userId, false);
    return { saved: true };
  } catch (e) {
    return toFormError(e);
  } finally {
    revalidatePath("/", "layout");
  }
}

export async function saveCheckinScheduleAction(
  _prev: CheckinScheduleState,
  fd: FormData,
): Promise<CheckinScheduleState> {
  const { userId } = await requireSession();
  try {
    const { before, after } = await updateCheckinSchedule(getServer().db, userId, {
      enabled: fd.get("enabled") === "on",
      day: Number(fd.get("day")),
      time: text(fd, "time"),
      emailEnabled: fd.get("emailEnabled") === "on",
    });
    return { saved: true, invited: await syncCalendar(before, after, userId, true) };
  } catch (e) {
    return toFormError(e);
  } finally {
    revalidatePath("/", "layout");
  }
}
