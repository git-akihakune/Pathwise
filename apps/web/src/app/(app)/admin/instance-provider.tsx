"use client";

import type { ProviderConfigView } from "@pathwise/core/services/providers";
import { useState, useTransition } from "react";
import { ProbeResults } from "@/components/probe-results";
import { type ModelSuggestions, ProviderForm } from "@/components/provider-form";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ProviderFormState } from "../settings/actions";
import { KIND_NAMES, STATUS_LABELS } from "../settings/provider-list";
import { saveInstanceProviderAction, testInstanceProviderAction } from "./actions";

export function InstanceProvider({
  config,
  allowCustom,
  suggestions,
}: {
  config: ProviderConfigView | null;
  allowCustom: boolean;
  suggestions: ModelSuggestions;
}) {
  // Changing the key remounts the form, which clears the key field after a save or cancel.
  const [formKey, setFormKey] = useState(0);
  const [outcome, setOutcome] = useState<ProviderFormState>();
  const [pending, start] = useTransition();

  async function save(prev: ProviderFormState, fd: FormData) {
    const next = await saveInstanceProviderAction(prev, fd);
    setOutcome(next);
    if (next?.result) setFormKey((k) => k + 1);
    return next;
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Used by everyone who hasn't connected their own provider. Usage is billed to this key.
      </p>
      {config && (
        <div className="flex items-center gap-3 text-sm">
          <span className="font-medium">{config.label}</span>
          <span>{KIND_NAMES[config.kind]}</span>
          {config.authFailed ? (
            <Badge variant="destructive">Key rejected</Badge>
          ) : (
            <Badge variant="secondary">{STATUS_LABELS[config.status]}</Badge>
          )}
          <span>{config.keyLast4 ? `••••${config.keyLast4}` : "No key"}</span>
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() =>
              start(async () => {
                setOutcome(await testInstanceProviderAction());
              })
            }
          >
            Test
          </Button>
        </div>
      )}
      {outcome?.result && <ProbeResults {...outcome.result} />}
      {outcome?.error && !config && <Alert variant="destructive">{outcome.error}</Alert>}
      <ProviderForm
        key={`${config?.id ?? "new"}-${formKey}`}
        scope="instance"
        allowCustom={allowCustom}
        suggestions={suggestions}
        initial={config ?? undefined}
        action={save}
        onCancel={() => setFormKey((k) => k + 1)}
      />
    </div>
  );
}
