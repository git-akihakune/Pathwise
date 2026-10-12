import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { EmbeddingModel, LanguageModel } from "ai";
import type { AppConfig } from "../config";
import { createMockEmbeddingModel, createMockModel } from "./mock";
import type { Capabilities, LlmPurpose, ProviderKind, ProviderModels } from "./types";

// Explicit string keys and base URLs stop the SDKs from reading *_API_KEY / *_BASE_URL from the
// environment: no env var may supply a provider key or redirect one.
const FIRST_PARTY = {
  anthropic: { baseURL: "https://api.anthropic.com/v1" },
  openai: { baseURL: "https://api.openai.com/v1" },
  google: { baseURL: "https://generativelanguage.googleapis.com/v1beta" },
};

/** Custom endpoints must not redirect: the policy checked only the configured host. */
export const noRedirectFetch: typeof fetch = (input, init) =>
  fetch(input, { ...init, redirect: "error" });

export interface ProviderTarget {
  id: string;
  kind: ProviderKind;
  baseUrl: string | null;
  apiKey: string | null;
  models: ProviderModels;
  contextWindow: number | null;
  capabilities: Capabilities | null;
}

export function createLanguageModel(
  config: Pick<AppConfig, "llmMode">,
  target: ProviderTarget,
  role: "main" | "fast",
  purpose: LlmPurpose,
  opts?: { structuredOutputs?: boolean },
): LanguageModel {
  if (config.llmMode === "mock") return createMockModel(role, purpose);
  const id = target.models[role];
  const apiKey = target.apiKey ?? undefined;
  switch (target.kind) {
    case "anthropic":
      return createAnthropic({ ...FIRST_PARTY.anthropic, apiKey: apiKey ?? "" })(id);
    case "openai":
      return createOpenAI({ ...FIRST_PARTY.openai, apiKey: apiKey ?? "" })(id);
    case "google":
      return createGoogleGenerativeAI({ ...FIRST_PARTY.google, apiKey: apiKey ?? "" })(id);
    case "openai_compatible":
      return createOpenAICompatible({
        name: "custom",
        baseURL: target.baseUrl ?? "",
        apiKey: apiKey || undefined,
        fetch: noRedirectFetch,
        supportsStructuredOutputs:
          opts?.structuredOutputs ?? target.capabilities?.jsonSchema ?? false,
      }).chatModel(id);
  }
}

export function createEmbeddingModel(
  config: Pick<AppConfig, "llmMode">,
  target: ProviderTarget,
): EmbeddingModel | null {
  const id = target.models.embedding;
  if (!id) return null;
  if (config.llmMode === "mock") return createMockEmbeddingModel(id);
  const apiKey = target.apiKey ?? undefined;
  switch (target.kind) {
    case "anthropic":
      return null;
    case "openai":
      return createOpenAI({ ...FIRST_PARTY.openai, apiKey: apiKey ?? "" }).embeddingModel(id);
    case "google":
      return createGoogleGenerativeAI({
        ...FIRST_PARTY.google,
        apiKey: apiKey ?? "",
      }).embeddingModel(id);
    case "openai_compatible":
      return createOpenAICompatible({
        name: "custom",
        baseURL: target.baseUrl ?? "",
        apiKey: apiKey || undefined,
        fetch: noRedirectFetch,
      }).embeddingModel(id);
  }
}
