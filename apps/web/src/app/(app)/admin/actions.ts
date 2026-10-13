"use server";

import {
  discardDeadLetter,
  inviteUser,
  promoteToAdmin,
  retryDeadLetter,
  revokeInvite,
  setSafetyResources,
  setSignupMode,
} from "@pathwise/core/admin";
import { NotFoundError } from "@pathwise/core/errors";
import type { SignupMode } from "@pathwise/core/instance";
import { createLogger } from "@pathwise/core/logger";
import { mailErrorFields, renderInviteEmail } from "@pathwise/core/mail";
import {
  getInstanceProviderConfig,
  setInstanceProviderConfig,
  testProviderConfig,
} from "@pathwise/core/services/providers";
import { revalidatePath } from "next/cache";
import { toFormError } from "@/lib/form-error";
import { getJobAdmin } from "@/lib/jobs";
import { parseProviderInput } from "@/lib/provider-input";
import { getServer } from "@/lib/server";
import { requireAdmin } from "@/lib/session";
import type { ProviderFormState } from "../settings/actions";

const log = createLogger("admin");

export type InviteState =
  | { error?: string; link?: string; email?: string; emailed?: boolean; emailFailed?: boolean }
  | undefined;

const MODES: readonly string[] = ["open", "invite_only", "closed"] satisfies SignupMode[];

export async function setSignupModeAction(mode: string): Promise<void> {
  const { userId } = await requireAdmin();
  if (!MODES.includes(mode)) throw new Error("invalid sign-up mode");
  await setSignupMode(getServer().db, userId, mode as SignupMode);
  revalidatePath("/admin");
}

export async function createInviteAction(
  _prev: InviteState,
  formData: FormData,
): Promise<InviteState> {
  const { userId, name } = await requireAdmin();
  const email = String(formData.get("email") ?? "").trim();
  if (!email.includes("@")) return { error: "Enter a valid email address." };
  const { db, config, mailer } = getServer();
  const { token } = await inviteUser(db, userId, email);
  revalidatePath("/admin");
  const link = `${config.appUrl}/invite/${token}`;
  if (!mailer.enabled) return { link };
  try {
    await mailer.send({
      to: email,
      ...(await renderInviteEmail({ inviterName: name, url: link })),
    });
    return { link, email, emailed: true };
  } catch (e) {
    log.error({ ...mailErrorFields(e), userId }, "invite email failed");
    return { link, email, emailFailed: true };
  }
}

export async function revokeInviteAction(formData: FormData): Promise<void> {
  const { userId } = await requireAdmin();
  await revokeInvite(getServer().db, userId, String(formData.get("inviteId") ?? ""));
  revalidatePath("/admin");
}

export async function saveInstanceProviderAction(
  _prev: ProviderFormState,
  fd: FormData,
): Promise<ProviderFormState> {
  const { userId } = await requireAdmin();
  const deps = getServer();
  try {
    const saved = await setInstanceProviderConfig(deps, userId, parseProviderInput(fd));
    const { checks, status, label } = await testProviderConfig(
      deps,
      { userId, role: "admin" },
      saved.id,
    );
    return { result: { label, status, checks } };
  } catch (e) {
    return toFormError(e);
  } finally {
    revalidatePath("/", "layout");
  }
}

export async function testInstanceProviderAction(): Promise<ProviderFormState> {
  const { userId } = await requireAdmin();
  const deps = getServer();
  try {
    const current = await getInstanceProviderConfig(deps.db, userId);
    if (!current) return { error: "No instance provider is configured." };
    const { checks, status, label } = await testProviderConfig(
      deps,
      { userId, role: "admin" },
      current.id,
    );
    return { result: { label, status, checks } };
  } catch (e) {
    return toFormError(e);
  } finally {
    revalidatePath("/", "layout");
  }
}

export type SafetyResourcesState = { saved?: boolean; error?: string } | undefined;

export async function saveSafetyResourcesAction(
  _prev: SafetyResourcesState,
  fd: FormData,
): Promise<SafetyResourcesState> {
  const { userId } = await requireAdmin();
  const names = fd.getAll("name").map(String);
  const urls = fd.getAll("url").map(String);
  try {
    await setSafetyResources(
      getServer().db,
      userId,
      names.map((name, i) => ({ name, url: urls[i] ?? "" })),
    );
    return { saved: true };
  } catch (e) {
    return toFormError(e);
  } finally {
    revalidatePath("/admin");
  }
}

export async function retryDeadLetterAction(formData: FormData): Promise<void> {
  const { userId } = await requireAdmin();
  try {
    await retryDeadLetter(getServer().db, await getJobAdmin(), userId, {
      queue: String(formData.get("queue") ?? ""),
      id: String(formData.get("id") ?? ""),
    });
  } catch (e) {
    if (!(e instanceof NotFoundError)) throw e;
  }
  revalidatePath("/admin");
}

export async function discardDeadLetterAction(formData: FormData): Promise<void> {
  const { userId } = await requireAdmin();
  try {
    await discardDeadLetter(getServer().db, await getJobAdmin(), userId, {
      queue: String(formData.get("queue") ?? ""),
      id: String(formData.get("id") ?? ""),
    });
  } catch (e) {
    if (!(e instanceof NotFoundError)) throw e;
  }
  revalidatePath("/admin");
}

export async function promoteUserAction(formData: FormData): Promise<void> {
  const { userId } = await requireAdmin();
  await promoteToAdmin(getServer().db, userId, String(formData.get("userId") ?? ""));
  revalidatePath("/admin");
}
