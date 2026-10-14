"use client";

import type { Milestone } from "@pathwise/core/services/plan";
import { useActionState, useState } from "react";
import { ConfirmDelete } from "@/components/confirm-delete";
import { EntityForm, Field, useOpenForm } from "@/components/entity-form";
import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { FormState } from "@/lib/entity-action";
import { recoverFormAction } from "@/lib/form-recovery";
import { addMilestoneAction, removeMilestoneAction, updateMilestoneAction } from "./actions";
import { formatDay } from "./format";

function MilestoneForm({
  planId,
  item,
  onDone,
}: {
  planId: string;
  item?: Milestone;
  onDone: () => void;
}) {
  const [resets, setResets] = useState(0);
  return (
    <EntityForm
      key={resets}
      action={item ? updateMilestoneAction : addMilestoneAction}
      entity={item}
      onDone={item ? onDone : () => setResets(resets + 1)}
      submitLabel={item ? "Save" : "Add milestone"}
      cancel={item ? undefined : false}
    >
      <input type="hidden" name="planId" value={planId} />
      <Field label={item ? "Title" : "New milestone"}>
        <Input name="title" defaultValue={item?.title} required />
      </Field>
      <Field label="Target date">
        <Input name="targetDate" type="date" defaultValue={item?.targetDate ?? ""} />
      </Field>
      <Field label="Description">
        <Textarea
          className="resize-none"
          name="description"
          defaultValue={item?.description ?? ""}
        />
      </Field>
    </EntityForm>
  );
}

function StatusSelect({ item }: { item: Milestone }) {
  const [state, submit] = useActionState<FormState, FormData>(
    recoverFormAction(updateMilestoneAction),
    undefined,
  );
  return (
    <Form
      noValidate
      trackChanges={false}
      result={state}
      action={submit}
      className="flex flex-col gap-1"
    >
      <input type="hidden" name="id" value={item.id} />
      <input type="hidden" name="version" value={item.version} />
      <select
        key={`${item.status}-${item.version}`}
        name="status"
        aria-label={`Status of ${item.title}`}
        defaultValue={item.status}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
      >
        <option value="open">Open</option>
        <option value="done">Done</option>
        <option value="dropped">Dropped</option>
      </select>
    </Form>
  );
}

function MilestoneItem({ planId, item }: { planId: string; item: Milestone }) {
  const form = useOpenForm(`milestone:${item.id}`);
  if (form.isOpen) {
    return (
      <li>
        <MilestoneForm planId={planId} item={item} onDone={form.close} />
      </li>
    );
  }
  return (
    <li className="entity-row">
      <div className="flex flex-col gap-1">
        <span className="font-medium">{item.title}</span>
        {item.targetDate && (
          <span className="text-sm text-muted-foreground">{formatDay(item.targetDate)}</span>
        )}
        {item.description && <span className="text-sm">{item.description}</span>}
      </div>
      <div className="flex items-start gap-2">
        <StatusSelect item={item} />
        <Button type="button" variant="outline" size="sm" onClick={form.show}>
          Edit
        </Button>
        <ConfirmDelete action={removeMilestoneAction} fields={{ id: item.id }} label="Remove" />
      </div>
    </li>
  );
}

export function MilestonesSection({ planId, items }: { planId: string; items: Milestone[] }) {
  return (
    <section aria-labelledby="milestones-heading" className="workspace-section flex flex-col gap-4">
      <h2 id="milestones-heading" className="font-heading text-lg font-semibold">
        Milestones
      </h2>
      <ol className="milestone-list flex flex-col gap-4">
        {items.map((item) => (
          <MilestoneItem key={item.id} planId={planId} item={item} />
        ))}
      </ol>
      <MilestoneForm planId={planId} onDone={() => {}} />
    </section>
  );
}
