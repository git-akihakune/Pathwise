"use client";

import type { Action, Milestone } from "@pathwise/core/services/plan";
import { useOptimistic, useState, useTransition } from "react";
import { ConfirmDelete } from "@/components/confirm-delete";
import { EntityForm, Field, useOpenForm } from "@/components/entity-form";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  addActionAction,
  removeActionAction,
  setActionStatusAction,
  updateActionAction,
} from "./actions";
import { formatDay } from "./format";

function ActionForm({
  planId,
  milestones,
  thisWeek,
  item,
  onDone,
}: {
  planId: string;
  milestones: Milestone[];
  thisWeek: string;
  item?: Action;
  onDone: () => void;
}) {
  const [resets, setResets] = useState(0);
  return (
    <EntityForm
      key={resets}
      action={item ? updateActionAction : addActionAction}
      entity={item}
      onDone={item ? onDone : () => setResets(resets + 1)}
      submitLabel={item ? "Save" : "Add action"}
      cancel={item ? undefined : false}
    >
      <input type="hidden" name="planId" value={planId} />
      <Field label={item ? "Title" : "New action"}>
        <Input name="title" defaultValue={item?.title} required />
      </Field>
      <Field label="Week of">
        <Input name="weekOf" type="date" defaultValue={item?.weekOf ?? thisWeek} required />
      </Field>
      <Field label="Milestone (optional)">
        <select
          name="milestoneId"
          defaultValue={item?.milestoneId ?? ""}
          className="h-9 w-64 rounded-md border border-input bg-transparent px-2 text-sm"
        >
          <option value="">None</option>
          {milestones.map((m) => (
            <option key={m.id} value={m.id}>
              {m.title}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Notes">
        <Textarea className="resize-none" name="notes" defaultValue={item?.notes ?? ""} />
      </Field>
    </EntityForm>
  );
}

function ActionItem({
  item,
  planId,
  milestones,
  thisWeek,
  onError,
}: {
  item: Action;
  planId: string;
  milestones: Milestone[];
  thisWeek: string;
  onError: (message: string | undefined) => void;
}) {
  const form = useOpenForm(`action:${item.id}`);
  const [status, setStatus] = useOptimistic(item.status);
  const [, startTransition] = useTransition();
  const change = (next: Action["status"]) =>
    startTransition(async () => {
      setStatus(next);
      const result = await setActionStatusAction(item.id, next, item.version);
      onError(result?.error);
    });
  if (form.isOpen) {
    return (
      <li>
        <ActionForm
          planId={planId}
          milestones={milestones}
          thisWeek={thisWeek}
          item={item}
          onDone={form.close}
        />
      </li>
    );
  }
  const milestone = milestones.find((m) => m.id === item.milestoneId);
  return (
    <li className="flex items-center gap-3 rounded-md border p-3">
      <Checkbox
        aria-label={`Done: ${item.title}`}
        checked={status === "done"}
        onCheckedChange={(checked) => change(checked === true ? "done" : "todo")}
      />
      <span className={status === "skipped" ? "line-through" : undefined}>{item.title}</span>
      {milestone && <Badge variant="secondary">{milestone.title}</Badge>}
      <div className="ml-auto flex gap-2">
        {status !== "done" && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => change(status === "skipped" ? "todo" : "skipped")}
          >
            {status === "skipped" ? "Undo" : "Skip"}
          </Button>
        )}
        <Button type="button" variant="outline" size="sm" onClick={form.show}>
          Edit
        </Button>
        <ConfirmDelete action={removeActionAction} fields={{ id: item.id }} label="Remove" />
      </div>
    </li>
  );
}

function WeekSection({
  heading,
  items,
  ...rest
}: {
  heading: string;
  items: Action[];
  planId: string;
  milestones: Milestone[];
  thisWeek: string;
  onError: (message: string | undefined) => void;
}) {
  const id = `week-${heading.replaceAll(" ", "-")}`;
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <h3 id={id} className="font-medium">
        {heading}
      </h3>
      {items.length === 0 && <p className="text-sm text-muted-foreground">Nothing planned.</p>}
      <ul className="flex flex-col gap-2">
        {items.map((item) => (
          <ActionItem key={item.id} item={item} {...rest} />
        ))}
      </ul>
    </section>
  );
}

export function ActionsSection({
  planId,
  actions,
  milestones,
  thisWeek,
}: {
  planId: string;
  actions: Action[];
  milestones: Milestone[];
  thisWeek: string;
}) {
  const [error, setError] = useState<string>();
  const weeks = [...new Set(actions.map((a) => a.weekOf))].sort();
  const upcoming = [thisWeek, ...weeks.filter((w) => w > thisWeek)];
  const earlier = weeks.filter((w) => w < thisWeek).reverse();
  const section = (week: string) => (
    <WeekSection
      key={week}
      heading={week === thisWeek ? "This week" : `Week of ${formatDay(week)}`}
      items={actions.filter((a) => a.weekOf === week)}
      planId={planId}
      milestones={milestones}
      thisWeek={thisWeek}
      onError={setError}
    />
  );
  return (
    <section aria-labelledby="actions-heading" className="workspace-section flex flex-col gap-4">
      <h2 id="actions-heading" className="font-heading text-lg font-semibold">
        Weekly actions
      </h2>
      {error && <Alert variant="destructive">{error}</Alert>}
      {upcoming.map(section)}
      {earlier.length > 0 && (
        <details className="flex flex-col gap-2">
          <summary className="cursor-pointer text-sm">Earlier weeks</summary>
          <div className="mt-2 flex flex-col gap-3">{earlier.map(section)}</div>
        </details>
      )}
      <ActionForm planId={planId} milestones={milestones} thisWeek={thisWeek} onDone={() => {}} />
    </section>
  );
}
