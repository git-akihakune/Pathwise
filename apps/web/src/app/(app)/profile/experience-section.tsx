"use client";

import type { Experience } from "@pathwise/core/services/profile";
import { ConfirmDelete } from "@/components/confirm-delete";
import { EntityForm, Field, useOpenForm } from "@/components/entity-form";
import { SourceLabel } from "@/components/source-label";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { deleteExperienceAction, saveExperienceAction } from "./actions";

function ExperienceForm({ item, onDone }: { item?: Experience; onDone: () => void }) {
  return (
    <EntityForm action={saveExperienceAction} entity={item} onDone={onDone}>
      <Field label="Job title">
        <Input name="title" defaultValue={item?.title} required />
      </Field>
      <Field label="Organization">
        <Input name="organization" defaultValue={item?.organization ?? ""} />
      </Field>
      <div className="flex gap-3">
        <Field label="Start">
          <Input name="startDate" defaultValue={item?.startDate ?? ""} />
        </Field>
        <Field label="End">
          <Input name="endDate" defaultValue={item?.endDate ?? ""} />
        </Field>
      </div>
      <p className="text-xs text-muted-foreground">
        YYYY or YYYY-MM. Leave End empty if this is your current role.
      </p>
      <Field label="Description">
        <Textarea name="description" defaultValue={item?.description ?? ""} />
      </Field>
      <Field label="Highlights (one per line)">
        <Textarea name="highlights" defaultValue={item?.highlights.join("\n") ?? ""} />
      </Field>
    </EntityForm>
  );
}

function ExperienceItem({ item }: { item: Experience }) {
  const form = useOpenForm(`experience:${item.id}`);
  if (form.isOpen) {
    return (
      <li>
        <ExperienceForm item={item} onDone={form.close} />
      </li>
    );
  }
  const dates =
    item.startDate || item.endDate ? `${item.startDate ?? "?"} – ${item.endDate ?? "present"}` : "";
  return (
    <li className="flex items-start justify-between gap-4 rounded-md border p-3">
      <div className="flex flex-col gap-1">
        <span>{[item.title, item.organization, dates].filter(Boolean).join(" · ")}</span>
        {item.description && <span className="text-sm">{item.description}</span>}
        {item.highlights.length > 0 && (
          <span className="text-sm text-muted-foreground">{item.highlights.join("; ")}</span>
        )}
        <SourceLabel type={item.sourceType} />
      </div>
      <div className="flex gap-2">
        <Button type="button" variant="outline" size="sm" onClick={form.show}>
          Edit
        </Button>
        <ConfirmDelete action={deleteExperienceAction} fields={{ id: item.id }} />
      </div>
    </li>
  );
}

export function ExperienceSection({ items }: { items: Experience[] }) {
  const add = useOpenForm("experience:new");
  return (
    <section aria-labelledby="experience-heading" className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 id="experience-heading" className="text-lg font-medium">
          Experience
        </h2>
        <Button type="button" variant="outline" size="sm" onClick={add.show}>
          Add experience
        </Button>
      </div>
      {add.isOpen && <ExperienceForm onDone={add.close} />}
      <ul className="flex flex-col gap-2">
        {items.map((item) => (
          <ExperienceItem key={item.id} item={item} />
        ))}
      </ul>
    </section>
  );
}
