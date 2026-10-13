import { listMemory } from "@pathwise/core/services/memory";
import { getOnboardingState } from "@pathwise/core/workflows";
import Link from "next/link";
import { PendingMemoryList } from "@/components/pending-memory-list";
import { Button } from "@/components/ui/button";
import { getServer } from "@/lib/server";
import { requireSession } from "@/lib/session";
import { skipOnboardingAction } from "./onboarding/actions";

export default async function TodayPage() {
  const { name, userId } = await requireSession();
  const { db } = getServer();
  const pending = await listMemory(db, userId, { status: ["pending"] });
  const onboarding = await getOnboardingState(db, userId);
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
      <p className="text-muted-foreground">Pick up where you left off with your coach.</p>
      <Link href="/coach" className="underline">
        Open Coach
      </Link>
      <PendingMemoryList items={pending} />
    </section>
  );
}
