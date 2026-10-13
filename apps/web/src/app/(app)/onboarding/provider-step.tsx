import Link from "next/link";
import { Button } from "@/components/ui/button";
import { advanceAction } from "./actions";

export function ProviderStep({ runId, stepId }: { runId: string; stepId: string }) {
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-xl font-semibold">Connect an AI provider</h2>
      <p>Pathwise uses your own AI provider. Add one in Settings, then come back here.</p>
      <div className="flex gap-2">
        <Button asChild variant="outline">
          <Link href="/settings">Open Settings</Link>
        </Button>
        <form action={advanceAction}>
          <input type="hidden" name="runId" value={runId} />
          <input type="hidden" name="stepId" value={stepId} />
          <Button type="submit">Check again</Button>
        </form>
      </div>
    </div>
  );
}
