"use client";

import type { MemoryCategory, MemoryItem } from "@pathwise/core/services/memory";
import { ConfirmDelete } from "@/components/confirm-delete";
import { SourceLabel } from "@/components/source-label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { deleteMemoryAction, saveMemoryAction } from "./actions";
import { EntityForm, Field, useOpenForm } from "./entity-form";

const GROUPS: [MemoryCategory, string][] = [
  ["value", "Values"],
  ["constraint", "Constraints"],
  ["aspiration", "Aspirations"],
  ["energizer", "Energizers"],
  ["drain", "Drains"],
  ["preference", "Preferences"],
];

function MemoryForm({ item, onDone }: { item?: MemoryItem; onDone: () => void }) {
  return (
    <EntityForm action={saveMemoryAction} entity={item} onDone={onDone}>
      <Field label="Category">
        <select
          name="category"
          defaultValue={item?.category ?? "value"}
          className="h-9 w-48 rounded-md border border-input bg-transparent px-2 text-sm"
        >
          {GROUPS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="What should I remember?">
        <Textarea name="content" defaultValue={item?.content} required />
      </Field>
    </EntityForm>
  );
}

function MemoryRow({ item }: { item: MemoryItem }) {
  const form = useOpenForm(`memory:${item.id}`);
  if (form.isOpen) {
    return (
      <li>
        <MemoryForm item={item} onDone={form.close} />
      </li>
    );
  }
  return (
    <li className="flex items-start justify-between gap-4 rounded-md border p-3">
      <div className="flex flex-col gap-1">
        <span className="flex flex-wrap items-center gap-2">
          {item.content}
          {item.sensitive && <Badge variant="secondary">Sensitive</Badge>}
        </span>
        <SourceLabel type={item.sourceType} />
      </div>
      <div className="flex gap-2">
        <Button type="button" variant="outline" size="sm" onClick={form.show}>
          Edit
        </Button>
        <ConfirmDelete action={deleteMemoryAction} fields={{ id: item.id }} />
      </div>
    </li>
  );
}

export function MemorySection({ items }: { items: MemoryItem[] }) {
  const add = useOpenForm("memory:new");
  return (
    <section aria-labelledby="memory-heading" className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 id="memory-heading" className="text-lg font-medium">
          What matters to you
        </h2>
        <Button type="button" variant="outline" size="sm" onClick={add.show}>
          Add something about you
        </Button>
      </div>
      {add.isOpen && <MemoryForm onDone={add.close} />}
      {GROUPS.map(([category, label]) => {
        const group = items.filter((i) => i.category === category);
        return (
          <section
            key={category}
            aria-labelledby={`memory-${category}`}
            className="flex flex-col gap-2"
          >
            <h3 id={`memory-${category}`} className="text-sm font-medium">
              {label}
            </h3>
            {group.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing yet.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {group.map((item) => (
                  <MemoryRow key={item.id} item={item} />
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </section>
  );
}
