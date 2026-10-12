import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { EmbeddingModel, LanguageModel } from "ai";
import type { AppConfig } from "../config";
import type { Capabilities, LlmPurpose, ProviderKind, ProviderModels } from "./types";

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
  _config: Pick<AppConfig, "llmMode">,
  target: ProviderTarget,
  role: "main" | "fast",
  _purpose: LlmPurpose,
  opts?: { structuredOutputs?: boolean },
): LanguageModel {
  const id = target.models[role];
  const apiKey = target.apiKey ?? undefined;
  switch (target.kind) {
    case "anthropic":
      return createAnthropic({ apiKey })(id);
    case "openai":
      return createOpenAI({ apiKey })(id);
    case "google":
      return createGoogleGenerativeAI({ apiKey })(id);
    case "openai_compatible":
      return createOpenAICompatible({
        name: "custom",
        baseURL: target.baseUrl ?? "",
        apiKey: apiKey || undefined,
        supportsStructuredOutputs:
          opts?.structuredOutputs ?? target.capabilities?.jsonSchema ?? false,
      }).chatModel(id);
  }
}

export function createEmbeddingModel(
  _config: Pick<AppConfig, "llmMode">,
  target: ProviderTarget,
): EmbeddingModel | null {
  const id = target.models.embedding;
  if (!id) return null;
  const apiKey = target.apiKey ?? undefined;
  switch (target.kind) {
    case "anthropic":
      return null;
    case "openai":
      return createOpenAI({ apiKey }).embeddingModel(id);
    case "google":
      return createGoogleGenerativeAI({ apiKey }).embeddingModel(id);
    case "openai_compatible":
      return createOpenAICompatible({
        name: "custom",
        baseURL: target.baseUrl ?? "",
        apiKey: apiKey || undefined,
      }).embeddingModel(id);
  }
}
