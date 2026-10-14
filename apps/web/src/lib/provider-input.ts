import { ValidationError } from "@pathwise/core/errors";
import type { ProviderKind } from "@pathwise/core/llm";
import type { ProviderConfigInput } from "@pathwise/core/services/providers";

const KINDS: readonly string[] = [
  "anthropic",
  "openai",
  "google",
  "openai_compatible",
] satisfies ProviderKind[];

export const text = (fd: FormData, name: string) => String(fd.get(name) ?? "").trim();
export const optional = (fd: FormData, name: string) => text(fd, name) || undefined;

export function parseProviderInput(fd: FormData): ProviderConfigInput & { id?: string } {
  const kind = text(fd, "kind");
  if (!KINDS.includes(kind)) throw new ValidationError("Choose a provider.");
  const embeddingRef = text(fd, "embeddingProviderConfigId");
  const contextWindow = optional(fd, "contextWindow");
  return {
    id: optional(fd, "id"),
    kind: kind as ProviderKind,
    label: text(fd, "label"),
    baseUrl: optional(fd, "baseUrl"),
    // An empty field means "keep the stored key".
    apiKey: optional(fd, "apiKey"),
    models: {
      main: text(fd, "mainModel"),
      fast: text(fd, "fastModel"),
      embedding: optional(fd, "embeddingModel"),
      embeddingProviderConfigId: embeddingRef && embeddingRef !== "self" ? embeddingRef : undefined,
    },
    contextWindow: contextWindow === undefined ? undefined : Number(contextWindow),
  };
}
