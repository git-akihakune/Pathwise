import type { ProviderKind } from "./types";

export const MODEL_SUGGESTIONS: Record<
  Exclude<ProviderKind, "openai_compatible">,
  { main: string; fast: string; embedding?: string }
> = {
  anthropic: { main: "claude-sonnet-5-5", fast: "claude-haiku-5-5" },
  openai: { main: "gpt-5.5", fast: "gpt-5.4-mini", embedding: "text-embedding-3-small" },
  google: {
    main: "gemini-3.1-pro-preview",
    fast: "gemini-3.5-flash-lite",
    embedding: "gemini-embedding-2",
  },
};

export const CONTEXT_WINDOWS: Record<string, number> = {
  "claude-opus-5-5": 1_000_000,
  "claude-sonnet-5-5": 1_000_000,
  "claude-haiku-5-5": 1_000_000,
  "gpt-5.5": 400_000,
  "gpt-5.4-mini": 400_000,
  "gemini-3.1-pro-preview": 1_048_576,
  "gemini-3.5-flash-lite": 1_048_576,
};

const UNKNOWN_MODEL_WINDOW = 128_000;
const CUSTOM_DEFAULT_WINDOW = 8_192;

export function staticPdfInput(kind: ProviderKind): boolean {
  return kind !== "openai_compatible";
}

export function contextWindowFor(
  kind: ProviderKind,
  modelId: string,
  userEntered: number | null,
): number {
  if (kind === "openai_compatible") return userEntered ?? CUSTOM_DEFAULT_WINDOW;
  return CONTEXT_WINDOWS[modelId] ?? UNKNOWN_MODEL_WINDOW;
}
