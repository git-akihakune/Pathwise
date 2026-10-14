"use client";

import type { ReviewInput } from "@pathwise/core/workflows";
import { useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { type OnboardingFormState, skipStepAction, submitReviewAction } from "./actions";

type Experience = ReviewInput["experiences"][number];
type Education = ReviewInput["education"][number];
type Skill = ReviewInput["skills"][number];

const LEVELS = ["basic", "working", "strong", "expert"] as const;
const SELECT = "h-9 rounded-md border border-input bg-transparent px-2 text-sm";
const DATE = "YYYY or YYYY-MM";

function Text({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string | null | undefined;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <Label className="flex-col items-start gap-1">
      {label}
      <Input
        value={value ?? ""}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </Label>
  );
}

const orNull = (v: string) => (v.trim() === "" ? null : v.trim());
const replace = <T,>(list: T[], i: number, patch: Partial<T>) =>
  list.map((x, j) => (j === i ? { ...x, ...patch } : x));
const without = <T,>(list: T[], i: number) => list.filter((_, j) => j !== i);

export function ReviewStep({
  runId,
  stepId,
  initial,
}: {
  runId: string;
  stepId: string;
  initial: ReviewInput;
}) {
  const [data, setData] = useState(initial);
  const [state, setState] = useState<OnboardingFormState>();
  const [pending, start] = useTransition();
  const [skipping, startSkip] = useTransition();
  const set = (patch: Partial<ReviewInput>) => setData((d) => ({ ...d, ...patch }));

  const save = () =>
    start(async () => {
      setState(await submitReviewAction(runId, data));
    });

  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-xl font-semibold">Check what we found</h2>

      <section className="flex flex-col gap-3">
        <h3 className="font-medium">Experience</h3>
        {data.experiences.map((e: Experience, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: rows are edited in place and have no ids
          <div key={i} className="grid gap-2 rounded-md border p-3 sm:grid-cols-2">
            <Text
              label="Title"
              value={e.title}
              onChange={(v) => set({ experiences: replace(data.experiences, i, { title: v }) })}
            />
            <Text
              label="Organization"
              value={e.organization}
              onChange={(v) =>
                set({ experiences: replace(data.experiences, i, { organization: orNull(v) }) })
              }
            />
            <Text
              label="Start"
              value={e.startDate}
              placeholder={DATE}
              onChange={(v) =>
                set({ experiences: replace(data.experiences, i, { startDate: orNull(v) }) })
              }
            />
            <Text
              label="End"
              value={e.endDate}
              placeholder={DATE}
              onChange={(v) =>
                set({ experiences: replace(data.experiences, i, { endDate: orNull(v) }) })
              }
            />
            <div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => set({ experiences: without(data.experiences, i) })}
              >
                Remove
              </Button>
            </div>
          </div>
        ))}
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="font-medium">Education</h3>
        {data.education.map((e: Education, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: rows are edited in place and have no ids
          <div key={i} className="grid gap-2 rounded-md border p-3 sm:grid-cols-2">
            <Text
              label="Institution"
              value={e.institution}
              onChange={(v) => set({ education: replace(data.education, i, { institution: v }) })}
            />
            <Text
              label="Qualification"
              value={e.qualification}
              onChange={(v) =>
                set({ education: replace(data.education, i, { qualification: orNull(v) }) })
              }
            />
            <Text
              label="Field"
              value={e.field}
              onChange={(v) => set({ education: replace(data.education, i, { field: orNull(v) }) })}
            />
            <div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => set({ education: without(data.education, i) })}
              >
                Remove
              </Button>
            </div>
          </div>
        ))}
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="font-medium">Skills</h3>
        {data.skills.map((s: Skill, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: rows are edited in place and have no ids
          <div key={i} className="flex flex-wrap items-end gap-2 rounded-md border p-3">
            <Text
              label="Skill"
              value={s.name}
              onChange={(v) => set({ skills: replace(data.skills, i, { name: v }) })}
            />
            <Label className="flex-col items-start gap-1">
              Level
              <select
                className={SELECT}
                value={s.level ?? ""}
                onChange={(e) =>
                  set({
                    skills: replace(data.skills, i, {
                      level: (e.target.value || null) as Skill["level"],
                    }),
                  })
                }
              >
                <option value="">Not set</option>
                {LEVELS.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </Label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => set({ skills: without(data.skills, i) })}
            >
              Remove
            </Button>
          </div>
        ))}
      </section>

      {(data.memories.length > 0 || data.stories.length > 0) && (
        <section className="flex flex-col gap-2">
          <h3 className="font-medium">Also noticed</h3>
          {data.memories.map((m, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: rows are edited in place and have no ids
            <Label key={`m${i}`} className="gap-2 font-normal">
              <input
                type="checkbox"
                checked={m.keep}
                onChange={(e) =>
                  set({ memories: replace(data.memories, i, { keep: e.target.checked }) })
                }
              />
              {m.content}
              {m.sensitive && " (sensitive)"}
            </Label>
          ))}
          {data.stories.map((s, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: rows are edited in place and have no ids
            <Label key={`s${i}`} className="gap-2 font-normal">
              <input
                type="checkbox"
                checked={s.keep}
                onChange={(e) =>
                  set({ stories: replace(data.stories, i, { keep: e.target.checked }) })
                }
              />
              {s.title}
            </Label>
          ))}
        </section>
      )}

      {state?.error && <Alert variant="destructive">{state.error}</Alert>}
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={pending || skipping} onClick={save}>
          Save and continue
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={pending || skipping}
          onClick={() => startSkip(() => skipStepAction(runId, stepId))}
        >
          Skip this step
        </Button>
      </div>
    </div>
  );
}
