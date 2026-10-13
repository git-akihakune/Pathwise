import { effectiveTimezone, getUserSettings } from "@pathwise/core/services/settings";
import { getToday } from "@pathwise/core/services/today";
import Link from "next/link";
import { PendingMemoryList } from "@/components/pending-memory-list";
import { ProposalCard } from "@/components/proposal-card";
import { Button } from "@/components/ui/button";
import { getServer } from "@/lib/server";
import { requireSession } from "@/lib/session";
import { skipOnboardingAction } from "./onboarding/actions";
import { TodayActions } from "./today-actions";
import { TodayCheckin } from "./today-checkin";

export default async function TodayPage() {
  const { name, userId } = await requireSession();
  const { db } = getServer();
  const [today, settings] = await Promise.all([getToday(db, userId), getUserSettings(db, userId)]);
  const { onboarding } = today;
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Welcome, {name}</h1>
      {(onboarding === "not_started" || onboarding === "in_progress") && (
        <div className="flex flex-col gap-3 rounded-md border p-4">
          <h2 className="text-lg font-medium">Set up your coach</h2>
          <p>
            Add your CV and tell me a bit about yourself so I can coach you properly. It takes about
            15 minutes.
          </p>
          <div className="flex gap-2">
            <Button asChild>
              <Link href="/onboarding">{onboarding === "in_progress" ? "Continue" : "Start"}</Link>
            </Button>
            <form action={skipOnboardingAction}>
              <Button type="submit" variant="ghost">
                Skip for now
              </Button>
            </form>
          </div>
        </div>
      )}
      {onboarding === "skipped" && (
        <Link href="/onboarding" className="text-sm underline">
          Finish setting up
        </Link>
      )}
      <TodayActions actions={today.actions} />
      <TodayCheckin checkin={today.checkin} timeZone={effectiveTimezone(settings)} />
      <section aria-labelledby="coach-note" className="flex flex-col gap-2">
        <h2 id="coach-note" className="text-lg font-medium">
          From your coach
        </h2>
        <p>{today.coachNote ?? "Say hello in Coach and I'll keep notes here."}</p>
      </section>
      {today.pendingProposals.length > 0 && (
        <section aria-labelledby="pending-proposals" className="flex flex-col gap-2">
          <h2 id="pending-proposals" className="text-lg font-medium">
            Waiting for your approval
          </h2>
          {today.pendingProposals.map((proposal) => (
            <ProposalCard key={proposal.id} proposalId={proposal.id} initial={proposal} />
          ))}
        </section>
      )}
      <PendingMemoryList items={today.pendingMemories} />
    </section>
  );
}
