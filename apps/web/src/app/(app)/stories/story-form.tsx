"use client";

import type { Story } from "@pathwise/core/services/stories";
import Link from "next/link";
import { EntityForm, Field } from "@/components/entity-form";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { saveStoryAction } from "./actions";

const STAR = [
  ["situation", "Situation"],
  ["task", "Task"],
  ["action", "Action"],
  ["result", "Result"],
] as const;

export function StoryForm({ story }: { story?: Story }) {
  return (
    <EntityForm
      action={saveStoryAction}
      entity={story}
      submitLabel="Save story"
      cancel={
        <Link href="/stories" className={buttonVariants({ variant: "outline" })}>
          Cancel
        </Link>
      }
    >
      <Field label="Title">
        <Input name="title" defaultValue={story?.title} required />
      </Field>
      {STAR.map(([name, label]) => (
        <Field key={name} label={label}>
          <Textarea name={name} defaultValue={story?.[name]} />
        </Field>
      ))}
      <Field label="Metrics">
        <Input name="metrics" defaultValue={story?.metrics ?? ""} />
      </Field>
      <Field label="Skills (comma-separated)">
        <Input name="skills" defaultValue={story?.skills.join(", ") ?? ""} />
      </Field>
    </EntityForm>
  );
}
