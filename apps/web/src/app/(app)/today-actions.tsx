"use client";

import type { Action } from "@pathwise/core/services/plan";
import { useOptimistic, useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { toggleActionAction } from "./actions";

function TodayAction({ item }: { item: Action }) {
  const [done, setDone] = useOptimistic(item.status === "done");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  return (
    <li className="flex flex-col gap-2 rounded-md border p-3">
      <label htmlFor={`today-action-${item.id}`} className="flex items-center gap-3">
        <Checkbox
          id={`today-action-${item.id}`}
          checked={done}
          disabled={pending}
          onCheckedChange={(checked) =>
            startTransition(async () => {
              setDone(checked === true);
              const result = await toggleActionAction(item.id, checked === true);
              setError(result?.error);
            })
          }
        />
        <span>{item.title}</span>
      </label>
      {error && <Alert variant="destructive">{error}</Alert>}
    </li>
  );
}

export function TodayActions({ actions }: { actions: Action[] }) {
  return (
    <section aria-labelledby="today-actions" className="flex flex-col gap-2">
      <h2 id="today-actions" className="text-lg font-medium">
        This week
      </h2>
      {actions.length === 0 ? (
        <p className="text-muted-foreground">
          No actions this week yet. Plan your week with your coach or on the Plan page.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {actions.map((item) => (
            <TodayAction key={item.id} item={item} />
          ))}
        </ul>
      )}
    </section>
  );
}
