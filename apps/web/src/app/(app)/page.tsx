export const metadata = { title: "Today" };

import { getActivePlan } from "@pathwise/core/services/plan";
import { effectiveTimezone, getUserSettings } from "@pathwise/core/services/settings";
import { getToday } from "@pathwise/core/services/today";
import { ArrowRight, Compass, MessageCircle, Sparkles } from "lucide-react";
import Link from "next/link";
import { CareerJourney } from "@/components/career-journey";
import { PageHeader } from "@/components/page-header";
import { PendingMemoryList } from "@/components/pending-memory-list";
import { ProposalCard } from "@/components/proposal-card";
import { Button, buttonVariants } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import { getServer } from "@/lib/server";
import { requireSession } from "@/lib/session";
import { skipOnboardingAction } from "./onboarding/actions";
import { TodayActions } from "./today-actions";
import { TodayCheckin } from "./today-checkin";

export default async function TodayPage() {
  const { name, userId } = await requireSession();
  const { db } = getServer();
  const [today, settings, plan] = await Promise.all([
    getToday(db, userId),
    getUserSettings(db, userId),
    getActivePlan(db, userId),
  ]);
  const { onboarding } = today;
  const week = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(`${today.weekOf}T00:00:00Z`));
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`Welcome, ${name}`}
        eyebrow={`Your week · ${week}`}
        description="A little clarity. A practical next step. Your week starts here."
        action={
          <Link href="/coach" className={buttonVariants()}>
            <MessageCircle aria-hidden="true" />
            Talk to your coach
          </Link>
        }
      />
      {(onboarding === "not_started" || onboarding === "in_progress") && (
        <section className="flex flex-wrap items-center justify-between gap-5 rounded-xl border border-primary/20 bg-accent p-6">
          <div className="max-w-xl">
            <h2 className="font-heading text-lg font-semibold">Set up your coach</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Add your CV and tell me a bit about yourself so I can coach you properly. It takes
              about 15 minutes.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/onboarding" className={buttonVariants()}>
              {onboarding === "in_progress" ? "Continue" : "Start"}
              <ArrowRight aria-hidden="true" />
            </Link>
            <Form noValidate action={skipOnboardingAction}>
              <Button type="submit" variant="ghost">
                Skip for now
              </Button>
            </Form>
          </div>
        </section>
      )}
      {onboarding === "skipped" && (
        <Link
          href="/onboarding"
          className="w-fit text-sm font-medium text-primary underline underline-offset-4"
        >
          Finish setting up
        </Link>
      )}
      <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1.65fr)_minmax(280px,1fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          <section aria-labelledby="your-direction" className="workspace-section">
            <div className="mb-5 flex items-start gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-primary">
                <Compass className="size-5" aria-hidden="true" />
              </span>
              <div>
                <h2
                  id="your-direction"
                  className="font-heading text-sm font-semibold text-muted-foreground"
                >
                  Your direction
                </h2>
                <p className="mt-1 font-heading text-xl font-semibold leading-snug">
                  {plan?.northStar ?? "Start with what matters to you."}
                </p>
              </div>
            </div>
            {!plan && (
              <p className="mb-6 text-sm text-muted-foreground">
                Explore possibilities with your coach, then make a plan you can follow.
              </p>
            )}
            <CareerJourney />
            <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
              <p className="text-xs text-muted-foreground">
                {plan
                  ? `${plan.milestones.filter((m) => m.status === "done").length} of ${plan.milestones.length} milestones completed`
                  : "Your direction can change as you learn."}
              </p>
              <Link
                href="/plan"
                className="inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline"
              >
                {plan ? "View your plan" : "Create your plan"}
                <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
            </div>
          </section>
          <TodayActions actions={today.actions} />
        </div>
        <div className="flex min-w-0 flex-col gap-6">
          <TodayCheckin checkin={today.checkin} timeZone={effectiveTimezone(settings)} />
          <section aria-labelledby="coach-note" className="workspace-section flex flex-col gap-4">
            <span className="flex size-10 items-center justify-center rounded-xl bg-accent text-primary">
              <Sparkles className="size-5" aria-hidden="true" />
            </span>
            <h2 id="coach-note" className="font-heading text-lg font-semibold">
              From your coach
            </h2>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
              {today.coachNote ?? "Say hello in Coach and I'll keep notes here."}
            </p>
            <Link
              href="/coach"
              className="inline-flex w-fit items-center gap-2 text-sm font-semibold text-primary hover:underline"
            >
              Continue the conversation
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          </section>
        </div>
      </div>
      {today.pendingProposals.length > 0 && (
        <section
          aria-labelledby="pending-proposals"
          className="workspace-section flex flex-col gap-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="pending-proposals" className="font-heading text-lg font-semibold">
              Waiting for your approval
            </h2>
            <span className="rounded-full bg-accent px-3 py-1 text-xs font-semibold text-primary">
              {today.pendingProposals.length} pending
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            Review your coach's suggestions. You decide what gets saved.
          </p>
          {today.pendingProposals.map((proposal) => (
            <ProposalCard key={proposal.id} proposalId={proposal.id} initial={proposal} />
          ))}
        </section>
      )}
      <PendingMemoryList items={today.pendingMemories} />
    </div>
  );
}
