"use client";

import type { ProviderConfigView } from "@pathwise/core/services/providers";
import { useActionState, useState } from "react";
import type { ProviderFormState } from "@/app/(app)/settings/actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type ModelSuggestions = Record<string, { main: string; fast: string; embedding?: string }>;
type Kind = ProviderConfigView["kind"];

const KIND_LABELS: Record<Kind, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google",
  openai_compatible: "OpenAI-compatible endpoint",
};

const field = "flex flex-col gap-2";

export function ProviderForm({
  scope,
  allowCustom,
  suggestions,
  embeddingOptions = [],
  initial,
  action,
  onCancel,
}: {
  scope: "user" | "instance";
  allowCustom: boolean;
  /** MODEL_SUGGESTIONS, passed in by the server page so this client bundle stays free of core/llm. */
  suggestions: ModelSuggestions;
  embeddingOptions?: { id: string; label: string }[];
  initial?: ProviderConfigView;
  action: (prev: ProviderFormState, fd: FormData) => Promise<ProviderFormState>;
  onCancel?: () => void;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const [kind, setKind] = useState<Kind>(initial?.kind ?? "anthropic");
  const [models, setModels] = useState({
    main: initial?.models.main ?? suggestions[kind]?.main ?? "",
    fast: initial?.models.fast ?? suggestions[kind]?.fast ?? "",
    embedding: initial?.models.embedding ?? suggestions[kind]?.embedding ?? "",
  });
  const [embeddingRef, setEmbeddingRef] = useState(
    initial?.models.embeddingProviderConfigId ?? "self",
  );
  const custom = kind === "openai_compatible";
  const editing = initial !== undefined;

  function changeKind(next: Kind) {
    const prev = suggestions[kind];
    const fill = suggestions[next];
    // Replace a model field only if it is empty or still the previous kind's suggestion.
    const swap = (role: "main" | "fast" | "embedding") =>
      models[role] === "" || models[role] === (prev?.[role] ?? "")
        ? (fill?.[role] ?? "")
        : models[role];
    setModels({ main: swap("main"), fast: swap("fast"), embedding: swap("embedding") });
    setKind(next);
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <h3 className="font-medium">{editing ? "Edit provider" : "Add a provider"}</h3>
      {initial && <input type="hidden" name="id" value={initial.id} />}

      <div className={field}>
        <Label htmlFor="provider-kind">Provider</Label>
        <Select name="kind" value={kind} onValueChange={(v) => changeKind(v as Kind)}>
          <SelectTrigger id="provider-kind" className="w-72">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="anthropic">{KIND_LABELS.anthropic}</SelectItem>
            <SelectItem value="openai">{KIND_LABELS.openai}</SelectItem>
            <SelectItem value="google">{KIND_LABELS.google}</SelectItem>
            {(allowCustom || custom) && (
              <SelectItem value="openai_compatible">{KIND_LABELS.openai_compatible}</SelectItem>
            )}
          </SelectContent>
        </Select>
      </div>

      <div className={field}>
        <Label htmlFor="provider-label">Label</Label>
        <Input
          id="provider-label"
          name="label"
          required
          maxLength={60}
          defaultValue={initial?.label ?? ""}
        />
      </div>

      {custom && (
        <div className={field}>
          <Label htmlFor="provider-base-url">Base URL</Label>
          <Input
            id="provider-base-url"
            name="baseUrl"
            placeholder="http://host.docker.internal:8080/v1"
            required
            defaultValue={initial?.baseUrl ?? ""}
          />
        </div>
      )}

      <div className={field}>
        <Label htmlFor="provider-api-key">API key</Label>
        <Input
          id="provider-api-key"
          name="apiKey"
          type="password"
          autoComplete="off"
          placeholder={
            editing ? "Leave blank to keep the current key" : custom ? "Optional" : undefined
          }
          required={!editing && !custom}
        />
      </div>

      <div className={field}>
        <Label htmlFor="provider-main-model">Main model</Label>
        <Input
          id="provider-main-model"
          name="mainModel"
          required
          value={models.main}
          onChange={(e) => setModels({ ...models, main: e.target.value })}
        />
      </div>
      <div className={field}>
        <Label htmlFor="provider-fast-model">Fast model</Label>
        <Input
          id="provider-fast-model"
          name="fastModel"
          required
          value={models.fast}
          onChange={(e) => setModels({ ...models, fast: e.target.value })}
        />
      </div>
      <div className={field}>
        <Label htmlFor="provider-embedding-model">Embedding model (optional)</Label>
        <Input
          id="provider-embedding-model"
          name="embeddingModel"
          value={models.embedding}
          onChange={(e) => setModels({ ...models, embedding: e.target.value })}
        />
      </div>

      {scope === "user" && (
        <div className={field}>
          <Label htmlFor="provider-embedding-provider">Embedding provider</Label>
          <Select
            name="embeddingProviderConfigId"
            value={embeddingRef}
            onValueChange={setEmbeddingRef}
          >
            <SelectTrigger id="provider-embedding-provider" className="w-72">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="self">This provider</SelectItem>
              {embeddingOptions.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {custom && (
        <div className={field}>
          <Label htmlFor="provider-context-window">Context window (tokens)</Label>
          <Input
            id="provider-context-window"
            name="contextWindow"
            type="number"
            placeholder="8192"
            defaultValue={initial?.contextWindow ?? ""}
          />
        </div>
      )}

      {state?.error && <Alert variant="destructive">{state.error}</Alert>}
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          Save and test
        </Button>
        {editing && (
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
