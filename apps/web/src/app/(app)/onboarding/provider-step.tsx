import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import { advanceAction } from "./actions";

export function ProviderStep({ runId, stepId }: { runId: string; stepId: string }) {
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-xl font-semibold">Connect an AI provider</h2>
      <p>Pathwise uses your own AI provider. Add one in Settings, then come back here.</p>
      <div className="flex flex-wrap gap-2">
        <Link href="/settings" className={buttonVariants({ variant: "outline" })}>
          Open Settings
        </Link>
        <Form noValidate action={advanceAction}>
          <input type="hidden" name="runId" value={runId} />
          <input type="hidden" name="stepId" value={stepId} />
          <Button type="submit">Check again</Button>
        </Form>
      </div>
    </div>
  );
}
