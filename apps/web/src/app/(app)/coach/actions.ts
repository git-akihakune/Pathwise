"use server";

import { ConflictError } from "@pathwise/core/errors";
import { approveProposal, getProposal, rejectProposal } from "@pathwise/core/services/proposals";
import { revalidatePath } from "next/cache";
import type { ProposalView } from "@/components/proposal-card";
import { type FormError, toFormError } from "@/lib/form-error";
import { getServer } from "@/lib/server";
import { requireSession } from "@/lib/session";
import { loadHistory, toProposalViews } from "./history";

// "Already resolved" is the useful message here, not the generic reload hint.
const proposalError = (e: unknown): FormError =>
  e instanceof ConflictError ? { error: e.message } : toFormError(e);

export async function getProposalAction(
  id: string,
): Promise<{ proposal: ProposalView } | FormError> {
  const { userId } = await requireSession();
  try {
    const [proposal] = await toProposalViews(userId, [
      await getProposal(getServer().db, userId, id),
    ]);
    return { proposal: proposal as ProposalView };
  } catch (e) {
    return proposalError(e);
  }
}

export async function approveProposalAction(
  id: string,
  editedPayload?: unknown,
): Promise<{ status: "approved" | "conflicted" } | FormError> {
  const { userId } = await requireSession();
  try {
    const { status } = await approveProposal(getServer().db, userId, id, { editedPayload });
    revalidatePath("/", "layout");
    return { status };
  } catch (e) {
    // A ZodError leaves the proposal pending; its message tells the user what to fix.
    return proposalError(e);
  }
}

export async function rejectProposalAction(
  id: string,
): Promise<{ status: "rejected" } | FormError> {
  const { userId } = await requireSession();
  try {
    await rejectProposal(getServer().db, userId, id);
    revalidatePath("/", "layout");
    return { status: "rejected" };
  } catch (e) {
    return proposalError(e);
  }
}

export async function loadEarlierAction(beforeIso: string) {
  const { userId } = await requireSession();
  const before = new Date(beforeIso);
  if (Number.isNaN(before.getTime())) return { error: "Couldn't load earlier messages." };
  return loadHistory(userId, before);
}
