"use client";

import type { Skill } from "@pathwise/core/services/profile";
import { ConfirmDelete } from "@/components/confirm-delete";
import { SourceLabel } from "@/components/source-label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { deleteSkillAction, saveSkillAction } from "./actions";
import { EntityForm, Field, useOpenForm } from "./entity-form";
import { SkillPicker } from "./skill-picker";

const LEVELS = {
  basic: "Basic",
  working: "Working",
  strong: "Strong",
  expert: "Expert",
};

function linkLabel(taxonomySkillId: string | null) {
  if (taxonomySkillId?.startsWith("onet:")) return "Linked to O*NET";
  if (taxonomySkillId?.startsWith("esco:")) return "Linked to ESCO";
  return null;
}

function SkillForm({ item, onDone }: { item?: Skill; onDone: () => void }) {
  return (
    <EntityForm action={saveSkillAction} entity={item} onDone={onDone}>
      <SkillPicker initialName={item?.name} initialTaxonomySkillId={item?.taxonomySkillId} />
      <Field label="Level">
        <select
          name="level"
          defaultValue={item?.level ?? ""}
          className="h-9 w-48 rounded-md border border-input bg-transparent px-2 text-sm"
        >
          <option value="">Not set</option>
          {Object.entries(LEVELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Evidence">
        <Textarea name="evidence" defaultValue={item?.evidence ?? ""} />
      </Field>
    </EntityForm>
  );
}

function SkillItem({ item }: { item: Skill }) {
  const form = useOpenForm(`skill:${item.id}`);
  if (form.isOpen) {
    return (
      <li>
        <SkillForm item={item} onDone={form.close} />
      </li>
    );
  }
  const link = linkLabel(item.taxonomySkillId);
  return (
    <li className="flex items-start justify-between gap-4 rounded-md border p-3">
      <div className="flex flex-col gap-1">
        <span className="flex flex-wrap items-center gap-2">
          {item.name}
          {item.level && (
            <span className="text-sm text-muted-foreground">{LEVELS[item.level]}</span>
          )}
          {link && <Badge variant="secondary">{link}</Badge>}
        </span>
        {item.evidence && <span className="text-sm">{item.evidence}</span>}
        <SourceLabel type={item.sourceType} />
      </div>
      <div className="flex gap-2">
        <Button type="button" variant="outline" size="sm" onClick={form.show}>
          Edit
        </Button>
        <ConfirmDelete action={deleteSkillAction} fields={{ id: item.id }} />
      </div>
    </li>
  );
}

export function SkillsSection({ items }: { items: Skill[] }) {
  const add = useOpenForm("skill:new");
  return (
    <section aria-labelledby="skills-heading" className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 id="skills-heading" className="text-lg font-medium">
          Skills
        </h2>
        <Button type="button" variant="outline" size="sm" onClick={add.show}>
          Add skill
        </Button>
      </div>
      {add.isOpen && <SkillForm onDone={add.close} />}
      <ul className="flex flex-col gap-2">
        {items.map((item) => (
          <SkillItem key={item.id} item={item} />
        ))}
      </ul>
    </section>
  );
}
