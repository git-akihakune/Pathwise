import { APICallError } from "ai";
import { MockEmbeddingModelV4, MockLanguageModelV4, mockValues } from "ai/test";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { getTestDb, resetDb } from "../../../../test/integration/db";
import {
  FULL_CAPS,
  insertConfig,
  seedUser,
  testConfig,
} from "../../../../test/integration/fixtures";
import { schema } from "../db";
import { embedTexts, generateStructured, generateTextFor, StructuredOutputError } from "./generate";
import type { Llm } from "./types";

const db = getTestDb();
const config = testConfig();
const deps = { db, config };
const Person = z.object({ name: z.string(), years: z.number().int() });
const usage = (i: number | null, o: number | null) => ({
  inputTokens: {
    total: i ?? undefined,
    noCache: i ?? undefined,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: { total: o ?? undefined, text: o ?? undefined, reasoning: undefined },
});
// null = the provider reports no usage
const reply = (text: string, i: number | null = 10, o: number | null = 20) => ({
  content: [{ type: "text" as const, text }],
  finishReason: { unified: "stop" as const, raw: undefined },
  usage: usage(i, o),
  warnings: [],
});
function scripted(...results: (ReturnType<typeof reply> | Error)[]) {
  const next = mockValues(...results);
  return new MockLanguageModelV4({
    modelId: "m",
    doGenerate: async () => {
      const r = next();
      if (r instanceof Error) throw r;
      return r;
    },
  });
}
let cfgId: string;
const llmFor = (
  model: MockLanguageModelV4,
  jsonSchema: boolean,
  embedding: Llm["embedding"] = null,
): Llm => ({
  userId: "u1",
  providerConfigId: cfgId,
  kind: "openai_compatible",
  capabilities: { ...FULL_CAPS, jsonSchema },
  model: () => model,
  modelId: (r) => (r === "embedding" ? (embedding?.modelId ?? null) : "m"),
  embedding,
});
const usageRows = () => db.select().from(schema.llmUsage);
const cfgRow = async () =>
  (await db.select().from(schema.providerConfigs).where(eq(schema.providerConfigs.id, cfgId)))[0];
const opts = {
  role: "fast" as const,
  purpose: "test.extract",
  schema: Person,
  instructions: "Extract the person.",
  prompt: "Ada, 3 years",
};
const apiError = (statusCode: number) =>
  new APICallError({
    message: "denied",
    url: "https://api",
    requestBodyValues: {},
    statusCode,
    isRetryable: false,
  });

beforeEach(async () => {
  await resetDb(db);
  await seedUser(db, "u1");
  cfgId = await insertConfig(db, config, {
    userId: "u1",
    kind: "openai_compatible",
    baseUrl: "http://127.0.0.1:8080/v1",
  });
});

describe("generateStructured", () => {
  it("uses native structured output when supported, and records usage", async () => {
    const model = scripted(reply('{"name":"Ada","years":3}'));
    expect(await generateStructured(deps, llmFor(model, true), opts)).toEqual({
      name: "Ada",
      years: 3,
    });
    expect(model.doGenerateCalls[0]?.responseFormat).toMatchObject({
      type: "json",
      schema: { type: "object" },
    });
    expect(await usageRows()).toEqual([
      expect.objectContaining({
        userId: "u1",
        providerConfigId: cfgId,
        model: "m",
        role: "fast",
        purpose: "test.extract",
        inputTokens: 10,
        outputTokens: 20,
      }),
    ]);
  });
  it("falls back to prompted JSON with the schema in the instructions", async () => {
    const model = scripted(reply('```json\n{"name":"Ada","years":3}\n```'));
    expect(await generateStructured(deps, llmFor(model, false), opts)).toEqual({
      name: "Ada",
      years: 3,
    });
    expect(model.doGenerateCalls[0]?.responseFormat?.type ?? "text").toBe("text");
    expect(JSON.stringify(model.doGenerateCalls[0]?.prompt[0])).toContain("integer");
  });
  it("repairs once with the validation errors (Review Focus 4)", async () => {
    const model = scripted(
      reply('{"name":"Ada","years":"three"}'),
      reply('{"name":"Ada","years":3}'),
    );
    expect(await generateStructured(deps, llmFor(model, false), opts)).toEqual({
      name: "Ada",
      years: 3,
    });
    expect(model.doGenerateCalls).toHaveLength(2);
    expect(JSON.stringify(model.doGenerateCalls[1]?.prompt.at(-1))).toContain("years");
    expect(await usageRows()).toHaveLength(2);
  });
  it("gives up after exactly one repair, on both paths (Review Focus 4)", async () => {
    for (const jsonSchema of [false, true]) {
      const model = scripted(
        reply("not json"),
        reply('{"name":1}'),
        reply('{"name":"Ada","years":3}'),
      );
      const err = await generateStructured(deps, llmFor(model, jsonSchema), opts).catch((e) => e);
      expect(err).toBeInstanceOf(StructuredOutputError);
      expect((err as StructuredOutputError).issues.length).toBeGreaterThan(0);
      expect(model.doGenerateCalls).toHaveLength(2);
    }
  });
  it("marks the config on 401 and rethrows, but not on 429 (Review Focus 3)", async () => {
    const limited = apiError(429);
    await expect(generateStructured(deps, llmFor(scripted(limited), true), opts)).rejects.toBe(
      limited,
    );
    expect((await cfgRow())?.authFailed).toBe(false);
    const denied = apiError(401);
    await expect(generateStructured(deps, llmFor(scripted(denied), true), opts)).rejects.toBe(
      denied,
    );
    expect(await cfgRow()).toMatchObject({ status: "degraded", authFailed: true });
  });
});

describe("generateTextFor and embedTexts", () => {
  it("returns text and estimates usage when the provider reports none", async () => {
    const model = scripted(reply("Hello there", null, null));
    expect(
      await generateTextFor(deps, llmFor(model, true), {
        role: "main",
        purpose: "test.text",
        instructions: "Hi",
        prompt: "abcdefgh",
      }),
    ).toBe("Hello there");
    const [row] = await usageRows();
    expect(row).toMatchObject({ role: "main", purpose: "test.text", outputTokens: 3 });
    expect(row?.inputTokens).toBeGreaterThan(0);
  });
  it("returns null without an embedding model, else vectors with embedding usage", async () => {
    expect(await embedTexts(deps, llmFor(scripted(), true), "test.embed", ["a"])).toBeNull();
    const model = new MockEmbeddingModelV4({
      maxEmbeddingsPerCall: 2,
      doEmbed: async ({ values }) => ({
        embeddings: values.map(() => [1, 0]),
        usage: { tokens: 7 },
        warnings: [],
      }),
    });
    const llm = llmFor(scripted(), true, { model, modelId: "emb", providerConfigId: cfgId });
    expect(await embedTexts(deps, llm, "test.embed", ["a", "b"])).toEqual([
      [1, 0],
      [1, 0],
    ]);
    expect(await usageRows()).toEqual([
      expect.objectContaining({ role: "embedding", model: "emb", inputTokens: 7, outputTokens: 0 }),
    ]);
  });
});
