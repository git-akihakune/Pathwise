export const metadata = { title: "Set up your coach" };

import {
  DOCUMENT_ERRORS,
  type DocumentExtraction,
  getDocument,
} from "@pathwise/core/services/documents";
import { listProposals } from "@pathwise/core/services/proposals";
import { latestSessionForRun } from "@pathwise/core/services/sessions";
import {
  advance,
  getActiveRun,
  getOnboardingState,
  getStep,
  manualHint,
  reviewInputFromExtraction,
  startWorkflow,
  stepMessages,
} from "@pathwise/core/workflows";
import { Check } from "lucide-react";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { RunPoller } from "@/components/run-poller";
import { StepAttention } from "@/components/step-attention";
import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import { getJobQueue } from "@/lib/jobs";
import { getServer } from "@/lib/server";
import { requireSession } from "@/lib/session";
import { toProposalViews } from "../coach/history";
import { refreshAction, retryAction, skipOnboardingAction, skipStepAction } from "./actions";
import { ConfirmStep } from "./confirm-step";
import { IngestStep } from "./ingest-step";
import { IntakeStep } from "./intake-step";
import { ProviderStep } from "./provider-step";
import { ReviewStep } from "./review-step";

const STEPS = ["Connect", "Your documents", "Review", "Get to know you", "Summary"];
const STEP_NUMBER: Record<string, number> = {
  provider_check: 1,
  ingest: 2,
  review_extraction: 3,
  intake: 4,
  snapshot: 5,
  confirm: 5,
};

export default async function OnboardingPage() {
  const { userId } = await requireSession();
  const { db, config } = getServer();
  const deps = { db, config, queue: getJobQueue() };
  if ((await getOnboardingState(db, userId)) === "completed") redirect("/coach");

  let run =
    (await getActiveRun(db, userId, "onboarding")) ??
    (await startWorkflow(deps, userId, "onboarding"));
  // A resume: compute steps re-check their work (the server may have restarted mid-step).
  if (run.status === "active" && getStep("onboarding", run.stepId)?.kind === "compute") {
    run = await advance(deps, userId, run.id);
  }
  if (run.status === "completed") redirect("/coach");
  if (run.status === "abandoned") redirect("/");

  const refresh = refreshAction.bind(null, run.id);
  const attention = run.status === "needs_attention" ? run.state.attention : undefined;
  const n = STEP_NUMBER[run.stepId] ?? 1;

  let body: React.ReactNode = null;
  if (attention) {
    body = (
      <StepAttention
        message={attention.message}
        manualHint={manualHint("onboarding", attention.stepId)}
        retry={retryAction.bind(null, run.id)}
        skip={skipStepAction.bind(null, run.id, attention.stepId)}
      />
    );
  } else if (run.stepId === "provider_check") {
    body = <ProviderStep runId={run.id} stepId={run.stepId} />;
  } else if (run.stepId === "ingest") {
    const documentId = typeof run.state.documentId === "string" ? run.state.documentId : null;
    const doc = documentId ? await getDocument(db, userId, documentId) : null;
    const pending = doc?.status === "pending";
    body = (
      <>
        <IngestStep
          runId={run.id}
          stepId={run.stepId}
          pending={pending}
          failure={doc?.status === "failed" && doc.error ? DOCUMENT_ERRORS[doc.error] : null}
        />
        <RunPoller active={pending} refresh={refresh} />
      </>
    );
  } else if (run.stepId === "review_extraction") {
    body = (
      <ReviewStep
        runId={run.id}
        stepId={run.stepId}
        initial={reviewInputFromExtraction(run.state.extraction as DocumentExtraction)}
      />
    );
  } else if (run.stepId === "intake") {
    body = (
      <IntakeStep
        runId={run.id}
        stepId={run.stepId}
        messages={await stepMessages(db, userId, run)}
      />
    );
  } else if (run.stepId === "snapshot") {
    body = (
      <>
        <h2 className="text-xl font-semibold">Writing up what I heard…</h2>
        <RunPoller active refresh={refresh} />
      </>
    );
  } else if (run.stepId === "confirm") {
    const session = await latestSessionForRun(db, userId, run.id);
    const pending = session
      ? await listProposals(db, userId, { status: ["pending"], sessionId: session.id })
      : [];
    body = (
      <ConfirmStep
        runId={run.id}
        stepId={run.stepId}
        heard={typeof run.state.heard === "string" ? run.state.heard : null}
        proposals={await toProposalViews(userId, pending)}
      />
    );
  }

  return (
    <section className="flex flex-col gap-6">
      <PageHeader
        title="Set up your coach"
        description={`Step ${n} of ${STEPS.length}: ${STEPS[n - 1]}`}
        eyebrow="A coach that knows you"
        action={
          <Form noValidate action={skipOnboardingAction}>
            <Button type="submit" variant="ghost" size="sm">
              Skip for now
            </Button>
          </Form>
        }
      />
      <ol aria-label="Setup progress" className="grid gap-3 sm:grid-cols-5">
        {STEPS.map((label, index) => (
          <li
            key={label}
            aria-current={index + 1 === n ? "step" : undefined}
            className={`flex items-center gap-3 rounded-lg border p-3 text-sm ${index + 1 === n ? "border-primary/30 bg-accent text-primary" : "bg-card text-muted-foreground"}`}
          >
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold">
              {index + 1 < n ? <Check className="size-3.5" aria-label="Completed" /> : index + 1}
            </span>
            <span>{label}</span>
          </li>
        ))}
      </ol>
      <div className="workspace-section">{body}</div>
    </section>
  );
}
