"use client";

import type { Education } from "@pathwise/core/services/profile";
import { ConfirmDelete } from "@/components/confirm-delete";
import { EntityForm, Field, useOpenForm } from "@/components/entity-form";
import { SourceLabel } from "@/components/source-label";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { deleteEducationAction, saveEducationAction } from "./actions";

function EducationForm({ item, onDone }: { item?: Education; onDone: () => void }) {
  return (
    <EntityForm action={saveEducationAction} entity={item} onDone={onDone}>
      <Field label="Institution">
        <Input name="institution" defaultValue={item?.institution} required />
      </Field>
      <Field label="Qualification">
        <Input name="qualification" defaultValue={item?.qualification ?? ""} />
      </Field>
      <Field label="Field of study">
        <Input name="field" defaultValue={item?.field ?? ""} />
      </Field>
      <div className="flex gap-3">
        <Field label="Start">
          <Input name="startDate" defaultValue={item?.startDate ?? ""} />
        </Field>
        <Field label="End">
          <Input name="endDate" defaultValue={item?.endDate ?? ""} />
        </Field>
      </div>
    </EntityForm>
  );
}

function EducationItem({ item }: { item: Education }) {
  const form = useOpenForm(`education:${item.id}`);
  if (form.isOpen) {
    return (
      <li>
        <EducationForm item={item} onDone={form.close} />
      </li>
    );
  }
  const dates =
    item.startDate || item.endDate ? `${item.startDate ?? "?"} – ${item.endDate ?? "present"}` : "";
  return (
    <li className="entity-row">
      <div className="flex flex-col gap-1">
        <span>
          {[item.institution, item.qualification, item.field, dates].filter(Boolean).join(" · ")}
        </span>
        <SourceLabel type={item.sourceType} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={form.show}>
          Edit
        </Button>
        <ConfirmDelete action={deleteEducationAction} fields={{ id: item.id }} />
      </div>
    </li>
  );
}

export function EducationSection({ items }: { items: Education[] }) {
  const add = useOpenForm("education:new");
  return (
    <section aria-labelledby="education-heading" className="workspace-section flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="education-heading" className="font-heading text-lg font-semibold">
          Education
        </h2>
        <Button type="button" variant="outline" size="sm" onClick={add.show}>
          Add education
        </Button>
      </div>
      {add.isOpen && <EducationForm onDone={add.close} />}
      {items.length === 0 && (
        <p className="rounded-lg bg-muted/60 p-4 text-sm text-muted-foreground">
          Add your education, training, or qualifications.
        </p>
      )}
      <ul className="flex flex-col gap-2">
        {items.map((item) => (
          <EducationItem key={item.id} item={item} />
        ))}
      </ul>
    </section>
  );
}
