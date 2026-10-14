"use client";

import type { ProviderConfigView } from "@pathwise/core/services/providers";
import { useState, useTransition } from "react";
import { ProbeResults } from "@/components/probe-results";
import { type ModelSuggestions, ProviderForm } from "@/components/provider-form";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PaginatedTable } from "@/components/ui/paginated-table";
import { TableCell, TableHead, TableRow } from "@/components/ui/table";
import {
  activateProviderAction,
  deleteProviderAction,
  type ProviderFormState,
  saveProviderAction,
  testProviderAction,
} from "./actions";

export const KIND_NAMES: Record<ProviderConfigView["kind"], string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google",
  openai_compatible: "OpenAI-compatible endpoint",
};

export const STATUS_LABELS: Record<ProviderConfigView["status"], string> = {
  full: "Full support",
  degraded: "Limited support",
  unsupported: "Not supported",
  untested: "Not tested",
};

export function ProviderList({
  configs,
  activeId,
  allowCustom,
  suggestions,
}: {
  configs: ProviderConfigView[];
  activeId: string | null;
  allowCustom: boolean;
  suggestions: ModelSuggestions;
}) {
  const [editing, setEditing] = useState<ProviderConfigView | undefined>();
  // Changing the key remounts the form, which clears it after a save.
  const [formKey, setFormKey] = useState(0);
  const [outcome, setOutcome] = useState<ProviderFormState>();
  const [pending, start] = useTransition();

  const run = (fn: () => Promise<ProviderFormState>) =>
    start(async () => {
      setOutcome(await fn());
    });

  async function save(prev: ProviderFormState, fd: FormData) {
    const next = await saveProviderAction(prev, fd);
    setOutcome(next);
    if (next?.result) {
      setEditing(undefined);
      setFormKey((k) => k + 1);
    }
    return next;
  }

  return (
    <div className="flex flex-col gap-4">
      {outcome?.result && <ProbeResults {...outcome.result} />}
      {outcome?.error && !editing && <Alert variant="destructive">{outcome.error}</Alert>}
      <PaginatedTable
        label="AI providers"
        columns={5}
        empty="No providers yet. Add one below."
        header={
          <TableRow>
            <TableHead>Label</TableHead>
            <TableHead>Provider</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Key</TableHead>
            <TableHead />
          </TableRow>
        }
        rows={configs.map((c) => {
          const usable = c.status === "full" || c.status === "degraded";
          return (
            <TableRow key={c.id}>
              <TableCell>{c.label}</TableCell>
              <TableCell>{KIND_NAMES[c.kind]}</TableCell>
              <TableCell className="flex gap-1">
                {c.authFailed ? (
                  <Badge variant="destructive">Key rejected</Badge>
                ) : (
                  <Badge variant="secondary">{STATUS_LABELS[c.status]}</Badge>
                )}
                {c.id === activeId && <Badge>Active</Badge>}
              </TableCell>
              <TableCell>{c.keyLast4 ? `••••${c.keyLast4}` : "No key"}</TableCell>
              <TableCell>
                <div className="flex justify-end gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    aria-busy={pending}
                    onClick={() => run(() => testProviderAction(c.id))}
                  >
                    Test
                  </Button>
                  {usable && !c.authFailed && c.id !== activeId && (
                    <Button
                      size="sm"
                      disabled={pending}
                      aria-busy={pending}
                      onClick={() => run(() => activateProviderAction(c.id))}
                    >
                      Activate
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setOutcome(undefined);
                      setEditing(c);
                      setFormKey((k) => k + 1);
                    }}
                  >
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    aria-busy={pending}
                    onClick={() => run(() => deleteProviderAction(c.id))}
                  >
                    Delete
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          );
        })}
      />
      <ProviderForm
        key={`${editing?.id ?? "new"}-${formKey}`}
        scope="user"
        allowCustom={allowCustom}
        suggestions={suggestions}
        embeddingOptions={configs
          .filter((c) => c.kind !== "anthropic" && c.id !== editing?.id)
          .map((c) => ({ id: c.id, label: c.label }))}
        initial={editing}
        action={save}
        onCancel={() => setEditing(undefined)}
      />
    </div>
  );
}
