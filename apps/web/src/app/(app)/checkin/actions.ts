"use server";

import { advance, getRun, retryStep } from "@pathwise/core/workflows";
import { revalidatePath } from "next/cache";
import { type FormError, toFormError } from "@/lib/form-error";
import { getJobQueue } from "@/lib/jobs";
import { getServer } from "@/lib/server";
import { requireSession } from "@/lib/session";

export type EnergyFormState = FormError | undefined;

const deps = () => {
  const { db, config } = getServer();
  return { db, config, queue: getJobQueue() };
};
const str = (fd: FormData, name: string) => {
  const value = fd.get(name);
  return typeof value === "string" ? value : "";
};

export async function advanceCheckinAction(runId: string, stepId: string): Promise<void> {
  const { userId } = await requireSession();
  await advance(deps(), userId, runId, { stepId, skip: true });
  revalidatePath("/checkin");
}

export async function retryCheckinAction(runId: string, stepId: string): Promise<void> {
  const { userId } = await requireSession();
  const d = deps();
  const run = await getRun(d.db, userId, runId);
  if (run.type === "checkin" && run.stepId === stepId) await retryStep(d, userId, runId);
  revalidatePath("/checkin");
}

export async function refreshCheckinAction(runId: string, stepId: string): Promise<void> {
  const { userId } = await requireSession();
  await advance(deps(), userId, runId, { stepId });
  revalidatePath("/checkin");
}

export async function saveEnergyAction(
  _prev: EnergyFormState,
  fd: FormData,
): Promise<EnergyFormState> {
  const { userId } = await requireSession();
  try {
    await advance(deps(), userId, str(fd, "runId"), {
      stepId: "energy",
      uiResult: { energy: Number(str(fd, "energy")), note: str(fd, "note") || undefined },
    });
  } catch (e) {
    return toFormError(e);
  }
  revalidatePath("/checkin");
}
