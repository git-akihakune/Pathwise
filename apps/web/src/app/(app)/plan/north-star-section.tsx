"use client";

import type { CareerPath } from "@pathwise/core/services/paths";
import type { ActivePlan } from "@pathwise/core/services/plan";
import { EntityForm, Field, useOpenForm } from "@/components/entity-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createPlanAction, updateNorthStarAction } from "./actions";

export function NewPlanForm({ paths }: { paths: CareerPath[] }) {
  return (
    <section className="workspace-section flex flex-col gap-4">
      <p className="text-muted-foreground">You don't have a plan yet.</p>
      <EntityForm action={createPlanAction} submitLabel="Create plan" cancel={false}>
        <Field label="North star">
          <Input name="northStar" required />
        </Field>
        <Field label="Based on path">
          <select
            name="careerPathId"
            defaultValue=""
            className="h-9 w-64 rounded-md border border-input bg-transparent px-2 text-sm"
          >
            <option value="">None</option>
            {paths.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </Field>
      </EntityForm>
    </section>
  );
}

export function NorthStarSection({ plan }: { plan: ActivePlan }) {
  const form = useOpenForm("north-star");
  return (
    <section className="workspace-section flex flex-col gap-4">
      <h2 className="font-heading text-lg font-semibold">North star</h2>
      {form.isOpen ? (
        <EntityForm action={updateNorthStarAction} entity={plan} onDone={form.close}>
          <Field label="North star">
            <Input name="northStar" defaultValue={plan.northStar} required />
          </Field>
        </EntityForm>
      ) : (
        <div className="flex flex-wrap items-start justify-between gap-4">
          <p className="max-w-2xl font-heading text-xl font-semibold leading-relaxed">
            {plan.northStar}
          </p>
          <Button type="button" variant="outline" size="sm" onClick={form.show}>
            Edit north star
          </Button>
        </div>
      )}
    </section>
  );
}
