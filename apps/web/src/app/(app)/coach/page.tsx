import type { Screen } from "@pathwise/core/agent";
import { getProviderStatusForUser } from "@pathwise/core/services/providers";
import { effectiveTimezone, getUserSettings } from "@pathwise/core/services/settings";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getServer } from "@/lib/server";
import { requireSession } from "@/lib/session";
import { Chat } from "./chat";
import { loadHistory } from "./history";

const SCREENS: readonly Screen[] = ["today", "coach", "profile", "stories", "plan"];
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function CoachPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { userId } = await requireSession();
  const { db } = getServer();
  const params = await searchParams;
  const from = one(params.from);
  const screen = SCREENS.find((s) => s === from) ?? "coach";
  const [history, status, settings] = await Promise.all([
    loadHistory(userId),
    getProviderStatusForUser(db, userId),
    getUserSettings(db, userId),
  ]);
  const needsProvider = status.source === "none" || status.authFailed;
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Coach</h1>
      {needsProvider && (
        <Card>
          <CardHeader>
            <CardTitle>
              {status.authFailed
                ? "Your API key was rejected."
                : "The coach needs an AI provider before it can reply."}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <p className="text-sm">
              Messages won't get a coaching reply until a provider is set up.
            </p>
            <Link href="/settings" className="underline">
              Set up a provider
            </Link>
          </CardContent>
        </Card>
      )}
      <Chat
        initialMessages={history.messages}
        initialProposals={history.proposals}
        initialHasMore={history.hasMore}
        screen={screen}
        prompt={one(params.prompt) ?? ""}
        timeZone={effectiveTimezone(settings)}
      />
    </section>
  );
}
