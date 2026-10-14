"use client";

import { useActionState } from "react";
import { ProposalCard, type ProposalView } from "@/components/proposal-card";
import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { recoverFormAction } from "@/lib/form-recovery";
import { confirmAction, type OnboardingFormState } from "./actions";

export function ConfirmStep({
  runId,
  stepId,
  heard,
  proposals,
}: {
  runId: string;
  stepId: string;
  /** Null when the summary step was skipped. */
  heard: string | null;
  proposals: ProposalView[];
}) {
  const [state, submit, pending] = useActionState<OnboardingFormState, FormData>(
    recoverFormAction(confirmAction),
    undefined,
  );
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-xl font-semibold">Here's what I heard</h2>
      <p className="whitespace-pre-wrap">
        {heard ??
          "We couldn't write a summary this time. You can review everything on your Profile."}
      </p>
      {proposals.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="font-medium">Things I'd like to remember</h3>
          {proposals.map((p) => (
            <ProposalCard key={p.id} proposalId={p.id} initial={p} />
          ))}
        </section>
      )}
      <Form noValidate result={state} action={submit} className="flex flex-col gap-3">
        <input type="hidden" name="runId" value={runId} />
        <input type="hidden" name="stepId" value={stepId} />
        <Label className="flex-col items-start gap-1">
          Anything I got wrong?
          <Textarea className="resize-none" name="correction" maxLength={1000} />
        </Label>
        <div>
          <Button type="submit" disabled={pending} aria-busy={pending}>
            Looks right
          </Button>
        </div>
      </Form>
    </div>
  );
}
