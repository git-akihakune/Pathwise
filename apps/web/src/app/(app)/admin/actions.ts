"use server";

import { inviteUser, revokeInvite, setSignupMode } from "@pathwise/core/admin";
import type { SignupMode } from "@pathwise/core/instance";
import {
  getInstanceProviderConfig,
  setInstanceProviderConfig,
  testProviderConfig,
} from "@pathwise/core/services/providers";
import { revalidatePath } from "next/cache";
import { toFormError } from "@/lib/form-error";
import { parseProviderInput } from "@/lib/provider-input";
import { getServer } from "@/lib/server";
import { requireAdmin } from "@/lib/session";
import type { ProviderFormState } from "../settings/actions";

export type InviteState = { error?: string; link?: string } | undefined;

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
  const { userId } = await requireAdmin();
  const email = String(formData.get("email") ?? "").trim();
  if (!email.includes("@")) return { error: "Enter a valid email address." };
  const { db, config } = getServer();
  const { token } = await inviteUser(db, userId, email);
  revalidatePath("/admin");
  return { link: `${config.appUrl}/invite/${token}` };
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
