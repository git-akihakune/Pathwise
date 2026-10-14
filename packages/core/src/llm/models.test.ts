import type { LanguageModelV4 } from "@ai-sdk/provider";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEmbeddingModel, createLanguageModel } from "./factory";
import { CONTEXT_WINDOWS, contextWindowFor, MODEL_SUGGESTIONS, staticPdfInput } from "./models";
import type { ProviderKind } from "./types";

const target = (kind: ProviderKind, embedding?: string) => ({
  id: "cfg",
  kind,
  apiKey: "k",
  contextWindow: null,
  capabilities: null,
  baseUrl: kind === "openai_compatible" ? "http://127.0.0.1:8080/v1" : null,
  models: { main: "m-main", fast: "m-fast", embedding },
});

describe("static capability tables", () => {
  it.each([
    ["anthropic", true],
    ["openai", true],
    ["google", true],
    ["openai_compatible", false],
  ] as const)("pdfInput for %s is %s", (kind, expected) =>
    expect(staticPdfInput(kind)).toBe(expected),
  );
  it("uses the table for known models and 128,000 for unknown models on known providers", () => {
    expect(contextWindowFor("anthropic", "claude-sonnet-5-5", null)).toBe(1_000_000);
    expect(contextWindowFor("anthropic", "claude-haiku-5-5", null)).toBe(1_000_000);
    expect(contextWindowFor("openai", "some-new-model", null)).toBe(128_000);
  });
  it("uses the user-entered window for custom endpoints, else 8,192, never the table", () => {
    expect(contextWindowFor("openai_compatible", "qwen3-4b", 32_768)).toBe(32_768);
    expect(contextWindowFor("openai_compatible", "qwen3-4b", null)).toBe(8_192);
    expect(contextWindowFor("openai_compatible", "claude-sonnet-5-5", null)).toBe(8_192);
  });
  it("has a context window for every suggested model", () => {
    for (const s of Object.values(MODEL_SUGGESTIONS))
      for (const id of [s.main, s.fast]) expect(CONTEXT_WINDOWS[id]).toBeGreaterThan(0);
  });
});

describe("createLanguageModel (live)", () => {
  it.each([
    ["anthropic", /^anthropic/],
    ["openai", /^openai/],
    ["google", /^google/],
    ["openai_compatible", /^custom/],
  ] as const)("builds a %s model with the role's model id", (kind, provider) => {
    const m = createLanguageModel(
      { llmMode: "live" },
      target(kind),
      "fast",
      "test",
    ) as LanguageModelV4;
    expect(m.modelId).toBe("m-fast");
    expect(m.provider).toMatch(provider);
  });
  it("has no embedding model without models.embedding, and none for Anthropic", () => {
    expect(createEmbeddingModel({ llmMode: "live" }, target("openai"))).toBeNull();
    expect(createEmbeddingModel({ llmMode: "live" }, target("anthropic", "e"))).toBeNull();
    expect(createEmbeddingModel({ llmMode: "live" }, target("openai", "e"))).not.toBeNull();
  });
});

describe("environment isolation", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
  it.each([
    ["anthropic", "ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL"],
    ["openai", "OPENAI_API_KEY", "OPENAI_BASE_URL"],
    ["google", "GOOGLE_GENERATIVE_AI_API_KEY", "GOOGLE_GENERATIVE_AI_BASE_URL"],
  ] as const)(
    "%s never uses a key or base URL from the environment",
    async (kind, keyVar, urlVar) => {
      vi.stubEnv(keyVar, "env-secret");
      vi.stubEnv(urlVar, "https://evil.example/v1");
      const fetchSpy = vi.fn(async () => new Response("{}", { status: 500 }));
      vi.stubGlobal("fetch", fetchSpy);
      const m = createLanguageModel(
        { llmMode: "live" },
        { ...target(kind), apiKey: null },
        "main",
        "test",
      ) as LanguageModelV4;
      try {
        await m.doGenerate({ prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }] });
      } catch {
        // the stubbed fetch returns 500
      }
      expect(fetchSpy).toHaveBeenCalled();
      const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
      expect(String(url)).not.toContain("evil.example");
      expect(JSON.stringify([url, init.headers])).not.toContain("env-secret");
    },
  );
});

describe("custom endpoint redirects", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("never follows redirects, for language and embedding models", async () => {
    const fetchSpy = vi.fn(async () => new Response("{}", { status: 500 }));
    vi.stubGlobal("fetch", fetchSpy);
    const cfg = { llmMode: "live" as const };
    const lm = createLanguageModel(cfg, target("openai_compatible"), "main", "chat");
    await Promise.resolve(
      (lm as LanguageModelV4).doGenerate({
        prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      }),
    ).catch(() => {});
    const em = createEmbeddingModel(cfg, target("openai_compatible", "emb"));
    await (em as unknown as { doEmbed: (o: unknown) => Promise<unknown> })
      .doEmbed({ values: ["x"] })
      .catch(() => {});
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    for (const call of fetchSpy.mock.calls) {
      expect((call as unknown as [string, RequestInit])[1].redirect).toBe("error");
    }
  });
});
