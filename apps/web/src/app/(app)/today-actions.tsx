"use client";

import type { Action } from "@pathwise/core/services/plan";
import Link from "next/link";
import { useOptimistic, useState, useTransition } from "react";
import { EmptyState } from "@/components/empty-state";
import { Alert } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { toggleActionAction } from "./actions";

function TodayAction({ item }: { item: Action }) {
  const [done, setDone] = useOptimistic(item.status === "done");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  return (
    <li className="flex flex-col gap-2 rounded-lg border border-border/80 bg-card p-4">
      <label htmlFor={`today-action-${item.id}`} className="flex items-center gap-3">
        <Checkbox
          id={`today-action-${item.id}`}
          checked={done}
          disabled={pending}
          aria-busy={pending}
          onCheckedChange={(checked) =>
            startTransition(async () => {
              setDone(checked === true);
              const result = await toggleActionAction(item.id, checked === true);
              setError(result?.error);
            })
          }
        />
        <span className={done ? "text-muted-foreground line-through" : "font-medium"}>
          {item.title}
        </span>
      </label>
      {error && <Alert variant="destructive">{error}</Alert>}
    </li>
  );
}

export function TodayActions({ actions }: { actions: Action[] }) {
  return (
    <section aria-labelledby="today-actions" className="workspace-section flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="today-actions" className="font-heading text-lg font-semibold">
          This week
        </h2>
        <Link href="/plan" className="text-sm font-semibold text-primary hover:underline">
          Manage actions
        </Link>
      </div>
      {actions.length === 0 ? (
        <EmptyState
          title="No actions this week yet."
          description="Plan your week with your coach or on the Plan page."
          action={
            <Link href="/plan" className="text-sm font-semibold text-primary hover:underline">
              Plan your next step →
            </Link>
          }
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {actions.map((item) => (
            <TodayAction key={item.id} item={item} />
          ))}
        </ul>
      )}
      {actions.length > 0 && (
        <p role="status" className="border-t pt-3 text-xs text-muted-foreground">
          {actions.filter((a) => a.status === "done").length} of {actions.length} actions completed
        </p>
      )}
    </section>
  );
}
