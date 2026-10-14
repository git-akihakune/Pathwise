import { createHash } from "node:crypto";
import type { EmbeddingModel } from "ai";
import { MockEmbeddingModelV4 } from "ai/test";
import { estimateTokens } from "../tokens";

function embedOne(value: string): number[] {
  const bytes = createHash("sha256").update(value).digest();
  const v = Array.from(bytes.subarray(0, 8), (b) => b / 127.5 - 1);
  const norm = Math.hypot(...v) || 1;
  return v.map((x) => x / norm);
}

export function createMockEmbeddingModel(modelId: string): EmbeddingModel {
  return new MockEmbeddingModelV4({
    provider: "mock",
    modelId,
    doEmbed: async ({ values }) => ({
      embeddings: values.map(embedOne),
      usage: { tokens: values.reduce((n, v) => n + estimateTokens(v), 0) },
      warnings: [],
    }),
  });
}
