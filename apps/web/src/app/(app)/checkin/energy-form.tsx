"use client";

import { useActionState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { type EnergyFormState, saveEnergyAction } from "./actions";

export function EnergyForm({ runId }: { runId: string }) {
  const [state, submit, pending] = useActionState<EnergyFormState, FormData>(
    saveEnergyAction,
    undefined,
  );
  return (
    <form action={submit} className="flex flex-col gap-4">
      <input type="hidden" name="runId" value={runId} />
      <fieldset className="flex flex-col gap-2">
        <legend className="font-medium">How's your energy this week?</legend>
        <p className="text-sm text-muted-foreground">1 = running on empty, 5 = full of energy</p>
        <div className="flex gap-6">
          {[1, 2, 3, 4, 5].map((energy) => (
            <Label key={energy} className="flex items-center gap-2">
              <input type="radio" name="energy" value={energy} required disabled={pending} />
              {energy}
            </Label>
          ))}
        </div>
      </fieldset>
      <Label className="flex-col items-start gap-1">
        Anything to add? (optional)
        <Textarea name="note" maxLength={1000} disabled={pending} />
      </Label>
      {state?.error && <Alert variant="destructive">{state.error}</Alert>}
      <div>
        <Button type="submit" disabled={pending}>
          Save
        </Button>
      </div>
    </form>
  );
}
