export const metadata = { title: "Weekly check-in" };

import { nextDueAt, type WeekSummary } from "@pathwise/core/services/checkins";
import { effectiveTimezone, getUserSettings } from "@pathwise/core/services/settings";
import { getActiveRun, latestRun, manualHint, stepMessages } from "@pathwise/core/workflows";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { RunPoller } from "@/components/run-poller";
import { StepAttention } from "@/components/step-attention";
import { Badge } from "@/components/ui/badge";
import { WorkflowChat } from "@/components/workflow-chat";
import { getServer } from "@/lib/server";
import { requireSession } from "@/lib/session";
import { advanceCheckinAction, refreshCheckinAction, retryCheckinAction } from "./actions";
import { EnergyForm } from "./energy-form";

const TITLES: Record<string, string> = {
  prepare: "Getting your week ready…",
  wins: "Wins",
  action_review: "This week's actions",
  blockers: "Blockers",
  energy: "Energy",
  replan: "Next week",
  summarize: "Wrapping up…",
};

export default async function CheckinPage() {
  const { userId } = await requireSession();
  const { db } = getServer();
  const open = await getActiveRun(db, userId, "checkin");
  const run = open ?? (await latestRun(db, userId, "checkin"));
  let body: React.ReactNode;
  if (!run || run.status === "abandoned") {
    const settings = await getUserSettings(db, userId);
    const due = nextDueAt(settings, new Date());
    const timeZone = effectiveTimezone(settings);
    const day = new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone }).format(due);
    const time = new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      timeZone,
    }).format(due);
    body = (
      <>
        <p>No check-in is open right now.</p>
        <p>
          Your next check-in is {day} at {time}.
        </p>
      </>
    );
  } else if (run.status === "completed") {
    body = (
      <>
        <h2 className="text-xl font-semibold">Check-in complete</h2>
        <p className="whitespace-pre-wrap">
          {typeof run.state.summary === "string" ? run.state.summary : "Thanks for checking in."}
        </p>
        <Link href="/" className="underline">
          Back to Today
        </Link>
      </>
    );
  } else {
    const attention = run.status === "needs_attention" ? run.state.attention : undefined;
    const moveOn = advanceCheckinAction.bind(null, run.id, run.stepId);
    let content: React.ReactNode;
    if (attention) {
      content = (
        <StepAttention
          message={attention.message}
          manualHint={manualHint("checkin", attention.stepId)}
          retry={retryCheckinAction.bind(null, run.id, run.stepId)}
          skip={moveOn}
        />
      );
    } else if (run.stepId === "prepare" || run.stepId === "summarize") {
      content = <RunPoller active refresh={refreshCheckinAction.bind(null, run.id, run.stepId)} />;
    } else if (run.stepId === "energy") {
      content = <EnergyForm runId={run.id} />;
    } else {
      const week = run.state.week as WeekSummary | undefined;
      content = (
        <>
          {run.stepId === "action_review" && week && (
            <ul className="flex flex-col gap-2">
              {[
                ...week.done.map((a) => ({ ...a, status: "done" })),
                ...week.remaining.map((a) => ({ ...a, status: "todo" })),
                ...week.skipped.map((a) => ({ ...a, status: "skipped" })),
              ].map((a) => (
                <li key={a.id} className="flex items-center gap-2">
                  <span>{a.title}</span>
                  <Badge variant="secondary">{a.status}</Badge>
                </li>
              ))}
            </ul>
          )}
          <WorkflowChat
            key={`${run.id}:${run.stepId}`}
            runId={run.id}
            stepId={run.stepId}
            initialMessages={await stepMessages(db, userId, run)}
            moveOn={moveOn}
          />
        </>
      );
    }
    body = (
      <>
        <h2 className="text-xl font-semibold">{TITLES[run.stepId]}</h2>
        {content}
      </>
    );
  }
  const weekOf = typeof run?.state.weekOf === "string" ? run.state.weekOf : null;
  return (
    <section className="flex flex-col gap-6">
      <PageHeader
        title="Weekly check-in"
        eyebrow="Pause. Reflect. Move forward."
        description={
          weekOf
            ? `Week of ${new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${weekOf}T00:00:00Z`))}`
            : "A little space to notice your wins and decide what comes next."
        }
      />
      <div className="workspace-section flex flex-col gap-6">{body}</div>
    </section>
  );
}
