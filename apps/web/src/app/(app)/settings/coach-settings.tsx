"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import { recoverFormAction } from "@/lib/form-recovery";
import { type CoachSettingsState, saveCoachSettingsAction } from "./actions";

const BLUNTNESS = ["Gentle", "Soft", "Balanced", "Direct", "Blunt"];

export function CoachSettings({
  bluntness,
  timezone,
  timezones,
}: {
  bluntness: number;
  timezone: string | null;
  timezones: string[];
}) {
  const [state, action, pending] = useActionState<CoachSettingsState, FormData>(
    recoverFormAction(saveCoachSettingsAction),
    undefined,
  );
  // Node's supportedValuesOf omits "UTC", so offer it explicitly.
  const all = timezones.includes("UTC") ? timezones : ["UTC", ...timezones];
  const zones = timezone && !all.includes(timezone) ? [timezone, ...all] : all;
  return (
    <Form noValidate result={state} action={action} className="flex flex-col gap-4">
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">Bluntness</legend>
        <div className="flex flex-wrap gap-4">
          {BLUNTNESS.map((name, i) => (
            <label key={name} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="bluntness"
                value={i + 1}
                defaultChecked={bluntness === i + 1}
              />
              {name}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex flex-col gap-2">
        <label htmlFor="coach-timezone" className="text-sm font-medium">
          Timezone
        </label>
        <select
          id="coach-timezone"
          name="timezone"
          defaultValue={timezone ?? ""}
          className="h-9 w-72 rounded-md border border-input bg-transparent px-2 text-sm"
        >
          <option value="">Not set (browser zone)</option>
          {zones.map((z) => (
            <option key={z} value={z}>
              {z}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending} aria-busy={pending}>
          Save coach settings
        </Button>
        {state?.saved && (
          <span role="status" className="text-sm text-muted-foreground">
            Saved.
          </span>
        )}
      </div>
    </Form>
  );
}
