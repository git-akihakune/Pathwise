"use server";

import { inviteUser, revokeInvite, setSignupMode } from "@pathwise/core/admin";
import type { SignupMode } from "@pathwise/core/instance";
import { revalidatePath } from "next/cache";
import { getServer } from "@/lib/server";
import { requireAdmin } from "@/lib/session";

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
