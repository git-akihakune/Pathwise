import type { LanguageModelV4 } from "@ai-sdk/provider";
import { beforeEach, describe, expect, it } from "vitest";
import { getTestDb, resetDb } from "../../../../test/integration/db";
import { insertConfig, seedUser, testConfig } from "../../../../test/integration/fixtures";
import { schema } from "../db";
import { ensureInstanceSettings } from "../instance";
import { pickProviderRow, requireLlm, resolveLlm } from "./resolve";

const db = getTestDb();
const config = testConfig();
const deps = { db, config };
const activate = (userId: string, id: string) =>
  db
    .insert(schema.userSettings)
    .values({ userId, providerConfigId: id })
    .onConflictDoUpdate({ target: schema.userSettings.userId, set: { providerConfigId: id } });
const setInstance = (id: string) =>
  db.update(schema.instanceSettings).set({ instanceProviderConfigId: id });

beforeEach(async () => {
  await resetDb(db);
  await ensureInstanceSettings(db);
  await seedUser(db, "u1");
});

describe("resolveLlm", () => {
  it("returns null when nothing is configured", async () => {
    expect(await resolveLlm(deps, "u1")).toBeNull();
    await expect(requireLlm(deps, "u1")).rejects.toMatchObject({
      name: "LlmUnavailableError",
      reason: "none",
    });
  });
  it("uses the user's active config", async () => {
    const id = await insertConfig(db, config, {
      userId: "u1",
      kind: "anthropic",
      models: { main: "claude-sonnet-5-5", fast: "claude-haiku-5-5" },
    });
    await activate("u1", id);
    const llm = await resolveLlm(deps, "u1");
    expect(llm).toMatchObject({
      userId: "u1",
      providerConfigId: id,
      kind: "anthropic",
      embedding: null,
    });
    expect(llm?.modelId("main")).toBe("claude-sonnet-5-5");
    expect(llm?.modelId("embedding")).toBeNull();
    expect((llm?.model("fast", "test") as LanguageModelV4 | undefined)?.modelId).toBe(
      "claude-haiku-5-5",
    );
  });
  it("falls back to the instance config when the user has none", async () => {
    const id = await insertConfig(db, config, { userId: null });
    await setInstance(id);
    expect((await resolveLlm(deps, "u1"))?.providerConfigId).toBe(id);
    expect(await pickProviderRow(db, "u1")).toMatchObject({ source: "instance", row: { id } });
  });
  it("does not fall back to the instance key when the user's key was rejected (Review Focus 3)", async () => {
    await setInstance(await insertConfig(db, config, { userId: null }));
    await activate(
      "u1",
      await insertConfig(db, config, { userId: "u1", status: "degraded", authFailed: true }),
    );
    expect(await resolveLlm(deps, "u1")).toBeNull();
    await expect(requireLlm(deps, "u1")).rejects.toMatchObject({ reason: "auth_failed" });
  });
  it.each(["untested", "unsupported"] as const)("returns null for a %s config", async (status) => {
    await activate("u1", await insertConfig(db, config, { userId: "u1", status }));
    expect(await resolveLlm(deps, "u1")).toBeNull();
  });
  it("returns null instead of throwing when the key cannot be decrypted", async () => {
    await activate(
      "u1",
      await insertConfig(db, testConfig({ appEncryptionKey: Buffer.alloc(32, 9) }), {
        userId: "u1",
      }),
    );
    expect(await resolveLlm(deps, "u1")).toBeNull();
    await expect(requireLlm(deps, "u1")).rejects.toMatchObject({ reason: "unusable" });
  });
  it("takes the embedding model from the embedding provider config", async () => {
    const emb = await insertConfig(db, config, {
      userId: "u1",
      kind: "openai_compatible",
      baseUrl: "http://127.0.0.1:8081/v1",
      apiKey: "",
      models: { main: "x", fast: "x", embedding: "nomic-embed" },
    });
    const id = await insertConfig(db, config, {
      userId: "u1",
      kind: "anthropic",
      models: { main: "a", fast: "b", embedding: "nomic-embed", embeddingProviderConfigId: emb },
    });
    await activate("u1", id);
    expect((await resolveLlm(deps, "u1"))?.embedding).toMatchObject({
      modelId: "nomic-embed",
      providerConfigId: emb,
    });
  });
});
