import type { EmbeddingModel, LanguageModel } from "ai";
import type { AppConfig } from "../config";
import type { Db } from "../db";

export type ProviderKind = "anthropic" | "openai" | "google" | "openai_compatible";
export type ModelRole = "main" | "fast" | "embedding";
export type ProviderStatus = "untested" | "full" | "degraded" | "unsupported";

export interface Capabilities {
  basic: boolean;
  streaming: boolean;
  tools: boolean;
  jsonSchema: boolean;
  pdfInput: boolean;
  contextWindow: number;
}

/** e.g. "probe", "chat", "classify", "extract.document"; each plan documents its purposes. */
export type LlmPurpose = string;

export interface ProviderModels {
  main: string;
  fast: string;
  embedding?: string;
  embeddingProviderConfigId?: string;
}

export type ProbeCheckName = "basic" | "streaming" | "tools" | "jsonSchema";
export type ProbeChecks = Record<ProbeCheckName, { ok: boolean; error?: string }>;

export interface Llm {
  userId: string;
  providerConfigId: string;
  kind: ProviderKind;
  capabilities: Capabilities;
  /** Mock mode: purpose selects the fixture. */
  model(role: "main" | "fast", purpose: LlmPurpose): LanguageModel;
  modelId(role: ModelRole): string | null;
  embedding: { model: EmbeddingModel; modelId: string; providerConfigId: string } | null;
}

export interface LlmDeps {
  db: Db;
  config: AppConfig;
}
