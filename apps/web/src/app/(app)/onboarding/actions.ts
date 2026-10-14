"use server";

import {
  createPastedDocument,
  UPLOAD_ERRORS,
  UploadRejectedError,
} from "@pathwise/core/services/documents";
import {
  advance,
  attachOnboardingDocument,
  type ReviewInput,
  retryStep,
  skipOnboarding,
} from "@pathwise/core/workflows";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { type FormError, toFormError } from "@/lib/form-error";
import { getJobQueue } from "@/lib/jobs";
import { getServer } from "@/lib/server";
import { requireSession } from "@/lib/session";

export type OnboardingFormState = FormError | undefined;

const deps = () => {
  const { db, config } = getServer();
  return { db, config, queue: getJobQueue() };
};
const str = (fd: FormData, name: string) => {
  const v = fd.get(name);
  return typeof v === "string" ? v : "";
};
const done = () => revalidatePath("/onboarding");

/** A step's form: `stepId` makes a stale submit (double click, second tab) a no-op. */
export async function advanceAction(fd: FormData): Promise<void> {
  const { userId } = await requireSession();
  await advance(deps(), userId, str(fd, "runId"), {
    stepId: str(fd, "stepId"),
    skip: fd.get("skip") === "1",
  });
  done();
}

/** Skips a step ("Move on", "Do it manually"). */
export async function skipStepAction(runId: string, stepId: string): Promise<void> {
  const { userId } = await requireSession();
  await advance(deps(), userId, runId, { stepId, skip: true });
  done();
}

export async function retryAction(runId: string): Promise<void> {
  const { userId } = await requireSession();
  await retryStep(deps(), userId, runId);
  done();
}

/** `advance` with no input: a compute step re-checks its work. */
export async function refreshAction(runId: string): Promise<void> {
  const { userId } = await requireSession();
  await advance(deps(), userId, runId);
  done();
}

export async function attachUploadAction(
  runId: string,
  documentId: string,
): Promise<OnboardingFormState> {
  const { userId } = await requireSession();
  try {
    await attachOnboardingDocument(deps(), userId, runId, documentId);
  } catch (e) {
    return toFormError(e);
  }
  done();
}

export async function pasteTextAction(
  _prev: OnboardingFormState,
  fd: FormData,
): Promise<OnboardingFormState> {
  const { userId } = await requireSession();
  const kind = str(fd, "kind") === "linkedin" ? "linkedin" : "cv";
  try {
    const d = deps();
    const doc = await createPastedDocument(d, userId, { text: str(fd, "text"), kind });
    await attachOnboardingDocument(d, userId, str(fd, "runId"), doc.id);
  } catch (e) {
    if (e instanceof UploadRejectedError) return { error: UPLOAD_ERRORS[e.reason] };
    return toFormError(e);
  }
  done();
}

export async function submitReviewAction(
  runId: string,
  payload: ReviewInput,
): Promise<OnboardingFormState> {
  const { userId } = await requireSession();
  try {
    await advance(deps(), userId, runId, { stepId: "review_extraction", uiResult: payload });
  } catch (e) {
    return toFormError(e);
  }
  done();
}

export async function confirmAction(
  _prev: OnboardingFormState,
  fd: FormData,
): Promise<OnboardingFormState> {
  const { userId } = await requireSession();
  try {
    await advance(deps(), userId, str(fd, "runId"), {
      stepId: str(fd, "stepId"),
      uiResult: { correction: str(fd, "correction") || undefined },
    });
  } catch (e) {
    return toFormError(e);
  }
  redirect("/coach");
}

export async function skipOnboardingAction(): Promise<void> {
  const { userId } = await requireSession();
  await skipOnboarding(deps(), userId);
  revalidatePath("/", "layout");
  redirect("/");
}
