"use client";

import type { MemoryCategory } from "@pathwise/core/services/memory";
import type { Proposal } from "@pathwise/core/services/proposals";
import Link from "next/link";
import { type FormEvent, useEffect, useState, useTransition } from "react";
import {
  approveProposalAction,
  getProposalAction,
  rejectProposalAction,
} from "@/app/(app)/coach/actions";
import { Field } from "@/components/entity-form";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

/** `titles` maps plan milestone/action ids to titles for plan proposals, whose payloads hold ids. */
export type ProposalView = Pick<Proposal, "id" | "kind" | "payload" | "status"> & {
  titles?: Record<string, string>;
};

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" ? (v as Obj) : {});
const str = (v: unknown) => (typeof v === "string" ? v : "");
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

const CATEGORIES: Record<MemoryCategory, string> = {
  value: "Value",
  constraint: "Constraint",
  aspiration: "Aspiration",
  energizer: "Energizer",
  drain: "Drain",
  preference: "Preference",
  fact: "Fact",
  event: "Event",
  observation: "Observation",
};

const TITLES: Record<Proposal["kind"], string> = {
  memory_add: "Remember this?",
  memory_update: "Update what I remember?",
  profile_update: "Update your profile?",
  story_add: "Save this story?",
  story_update: "Update this story?",
  path_save: "Save this career path?",
  plan_create: "Create this plan?",
  plan_change: "Change your plan?",
  action_status_update: "Update your actions?",
};

const OPS: Record<string, string> = { create: "Add", update: "Change", delete: "Remove" };
const STORY_FIELDS = ["title", "situation", "task", "action", "result", "metrics"];
const LONG_FIELDS = new Set(["content", "situation", "task", "action", "result", "description"]);

/** A short name for what the proposal is about, used in the regenerate prompt. */
function subject(p: ProposalView): string {
  const pl = obj(p.payload);
  const fields = obj(pl.fields);
  return (
    str(pl.content) ||
    str(pl.title) ||
    str(pl.northStar) ||
    str(fields.title) ||
    str(fields.name) ||
    TITLES[p.kind].replace("?", "")
  );
}

function Body({ p }: { p: ProposalView }) {
  const pl = obj(p.payload);
  const title = (id: unknown, fallback: string) => p.titles?.[str(id)] ?? fallback;
  switch (p.kind) {
    case "memory_add":
    case "memory_update":
      return (
        <div className="flex flex-wrap items-center gap-2">
          {str(pl.content) && <span>{str(pl.content)}</span>}
          {str(pl.category) && (
            <Badge variant="secondary">{CATEGORIES[pl.category as MemoryCategory]}</Badge>
          )}
          {pl.sensitive === true && <Badge variant="outline">Sensitive</Badge>}
        </div>
      );
    case "profile_update": {
      const fields = obj(pl.fields);
      const name = str(fields.name) || str(fields.title);
      return (
        <p>
          {OPS[str(pl.op)]} {str(pl.entity)}
          {name && `: ${name}`}
        </p>
      );
    }
    case "story_add":
      return (
        <div className="flex flex-col gap-1">
          <span className="font-medium">{str(pl.title)}</span>
          {str(pl.result) && <span className="text-sm">{str(pl.result)}</span>}
        </div>
      );
    case "story_update":
      return str(obj(pl.fields).title) ? <p>{str(obj(pl.fields).title)}</p> : null;
    case "path_save":
      return <p>{str(pl.title)}</p>;
    case "plan_create":
      return (
        <div className="flex flex-col gap-1">
          <span className="font-medium">{str(pl.northStar)}</span>
          <span className="text-sm text-muted-foreground">
            {plural(list(pl.milestones).length, "milestone")},{" "}
            {plural(list(pl.actions).length, "action")}
          </span>
        </div>
      );
    case "plan_change": {
      const ms = obj(pl.milestones);
      const as = obj(pl.actions);
      const lines = [
        ...(str(pl.northStar) ? [`~ North star: ${str(pl.northStar)}`] : []),
        ...[...list(ms.add), ...list(as.add)].map((x) => `+ ${str(obj(x).title)}`),
        ...list(ms.update).map((x) => `~ ${str(obj(x).title) || title(obj(x).id, "A milestone")}`),
        ...list(as.update).map((x) => `~ ${str(obj(x).title) || title(obj(x).id, "An action")}`),
        ...list(ms.remove).map((id) => `− ${title(id, "A milestone")}`),
        ...list(as.remove).map((id) => `− ${title(id, "An action")}`),
      ];
      return (
        <ul className="text-sm">
          {lines.map((l, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static list, lines may repeat
            <li key={i}>{l}</li>
          ))}
        </ul>
      );
    }
    case "action_status_update":
      return (
        <ul className="text-sm">
          {list(pl.updates).map((u) => (
            <li key={str(obj(u).actionId)}>
              {title(obj(u).actionId, "An action")}: {str(obj(u).status)}
            </li>
          ))}
        </ul>
      );
  }
}

/** The editable string fields: [object holding them, keys]. Null when the kind can't be edited. */
function editable(p: ProposalView): { target: Obj; keys: string[] } | null {
  const pl = obj(p.payload);
  switch (p.kind) {
    case "memory_add":
    case "memory_update":
      return { target: pl, keys: ["content"] };
    case "story_add":
      return { target: pl, keys: STORY_FIELDS };
    case "story_update":
      return { target: obj(pl.fields), keys: STORY_FIELDS.filter((k) => k in obj(pl.fields)) };
    case "profile_update": {
      const fields = obj(pl.fields);
      const keys = Object.keys(fields).filter((k) => typeof fields[k] === "string");
      return pl.op === "delete" || keys.length === 0 ? null : { target: fields, keys };
    }
    default:
      return null;
  }
}

const label = (key: string) => {
  const words = key.replace(/([A-Z])/g, " $1").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

function EditForm({
  p,
  disabled,
  onSave,
  onCancel,
}: {
  p: ProposalView;
  disabled: boolean;
  onSave: (payload: unknown) => void;
  onCancel: () => void;
}) {
  const edit = editable(p);
  if (!edit) return null;
  const isMemory = p.kind === "memory_add" || p.kind === "memory_update";
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const changed: Obj = { ...edit.target };
    for (const key of edit.keys) {
      const value = str(fd.get(key)).trim();
      // Leaving an unset optional field empty keeps it unset.
      if (value !== "" || typeof edit.target[key] === "string") changed[key] = value;
    }
    if (isMemory && fd.get("category")) changed.category = fd.get("category");
    const pl = obj(p.payload);
    onSave(edit.target === pl ? changed : { ...pl, fields: changed });
  };
  return (
    <Form noValidate onSubmit={submit} className="flex flex-col gap-3">
      {isMemory && (
        <Field label="Category">
          <select
            name="category"
            defaultValue={str(obj(p.payload).category) || "preference"}
            className="h-9 w-48 rounded-md border border-input bg-transparent px-2 text-sm"
          >
            {Object.entries(CATEGORIES).map(([value, text]) => (
              <option key={value} value={value}>
                {text}
              </option>
            ))}
          </select>
        </Field>
      )}
      {edit.keys.map((key) => (
        <Field key={key} label={label(key)}>
          {LONG_FIELDS.has(key) ? (
            <Textarea className="resize-none" name={key} defaultValue={str(edit.target[key])} />
          ) : (
            <Input name={key} defaultValue={str(edit.target[key])} />
          )}
        </Field>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={disabled}>
          Save and approve
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </Form>
  );
}

export function ProposalCard({
  proposalId,
  initial,
  onRegenerate,
}: {
  proposalId: string;
  initial?: ProposalView;
  onRegenerate?: (prompt: string) => void;
}) {
  const [proposal, setProposal] = useState(initial);
  const [error, setError] = useState<string>();
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (initial) return;
    let live = true;
    getProposalAction(proposalId).then((r) => {
      if (!live) return;
      if ("error" in r) setError(r.error);
      else setProposal(r.proposal);
    });
    return () => {
      live = false;
    };
  }, [proposalId, initial]);

  if (!proposal) {
    return (
      <div
        data-testid="proposal-card"
        className="min-h-32 rounded-xl border bg-accent/40 p-5 text-sm"
      >
        {error ?? "Loading suggestion…"}
      </div>
    );
  }

  const run = (action: () => Promise<{ status: Proposal["status"] } | { error: string }>) =>
    startTransition(async () => {
      const r = await action();
      if ("error" in r) {
        setError(`Couldn't apply this change: ${r.error}`);
        return;
      }
      setError(undefined);
      setEditing(false);
      setProposal({ ...proposal, status: r.status });
    });
  const approve = (edited?: unknown) => run(() => approveProposalAction(proposal.id, edited));
  const prompt = `Please redo your suggestion "${subject(proposal)}" using my current data.`;

  return (
    <div
      data-testid="proposal-card"
      className="flex flex-col gap-4 rounded-xl border border-primary/20 bg-accent/40 p-5"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-medium">{TITLES[proposal.kind]}</h3>
        {proposal.status === "approved" && <Badge>Approved</Badge>}
        {proposal.status === "rejected" && <Badge variant="secondary">Rejected</Badge>}
      </div>
      {editing ? (
        <EditForm
          p={proposal}
          disabled={pending}
          aria-busy={pending}
          onSave={approve}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <Body p={proposal} />
      )}
      {error && <Alert variant="destructive">{error}</Alert>}
      {proposal.status === "pending" && !editing && (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            disabled={pending}
            aria-busy={pending}
            onClick={() => approve()}
          >
            Approve
          </Button>
          {editable(proposal) && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={pending}
              aria-busy={pending}
              onClick={() => setEditing(true)}
            >
              Edit
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            aria-busy={pending}
            onClick={() => run(() => rejectProposalAction(proposal.id))}
          >
            Reject
          </Button>
        </div>
      )}
      {proposal.status === "conflicted" && (
        <div className="flex flex-col items-start gap-2">
          <p className="text-sm">This changed since it was suggested.</p>
          {onRegenerate ? (
            <Button type="button" size="sm" variant="outline" onClick={() => onRegenerate(prompt)}>
              Regenerate against current data
            </Button>
          ) : (
            <Link
              className={buttonVariants({ size: "sm", variant: "outline" })}
              href={`/coach?prompt=${encodeURIComponent(prompt)}`}
            >
              Regenerate against current data
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
