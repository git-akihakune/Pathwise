"use client";

import { useActionState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { type CheckinScheduleState, saveCheckinScheduleAction } from "./actions";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function CheckinScheduleForm({
  enabled,
  day,
  time,
  emailEnabled,
  timezone,
  smtpConfigured,
}: {
  enabled: boolean;
  day: number;
  time: string;
  emailEnabled: boolean;
  timezone: string;
  smtpConfigured: boolean;
}) {
  const [state, action, pending] = useActionState<CheckinScheduleState, FormData>(
    saveCheckinScheduleAction,
    undefined,
  );
  return (
    <form action={action} className="flex flex-col gap-4">
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="enabled" defaultChecked={enabled} />
        Weekly check-ins
      </label>
      <div className="flex gap-4">
        <div className="flex flex-col gap-2">
          <label htmlFor="checkin-day" className="text-sm font-medium">
            Day
          </label>
          <select
            id="checkin-day"
            name="day"
            defaultValue={String(day)}
            className="h-9 w-40 rounded-md border border-input bg-transparent px-2 text-sm"
          >
            {DAYS.map((name, i) => (
              <option key={name} value={i}>
                {name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor="checkin-time" className="text-sm font-medium">
            Time
          </label>
          <input
            id="checkin-time"
            type="time"
            name="time"
            defaultValue={time}
            className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
          />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="emailEnabled" defaultChecked={emailEnabled} />
        Email me check-ins
      </label>
      <p className="text-sm text-muted-foreground">Times are in {timezone}.</p>
      {!smtpConfigured && (
        <p className="text-sm text-muted-foreground">
          Email isn't set up on this instance, so check-ins appear in the app only.
        </p>
      )}
      {state?.error && <Alert variant="destructive">{state.error}</Alert>}
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          Save check-in schedule
        </Button>
        {state?.saved && (
          <span className="text-sm text-muted-foreground">Check-in schedule saved.</span>
        )}
      </div>
    </form>
  );
}
