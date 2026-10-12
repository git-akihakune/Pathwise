import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getTestDb, resetDb } from "../../../../../test/integration/db";
import { seedUser, testConfig } from "../../../../../test/integration/fixtures";
import { decryptSecret, loadKeyring } from "../../crypto";
import { schema } from "../../db";
import { ForbiddenError, NotFoundError, ValidationError } from "../../errors";
import { ensureInstanceSettings } from "../../instance";
import { markAuthFailed, registerMockFixture } from "../../llm";
import { probeFixture } from "../../llm/mock/fixtures/probe";
import { getUserSettings } from "../settings";
import {
  activateProviderConfig,
  deleteProviderConfig,
  getInstanceProviderConfig,
  getProviderStatusForUser,
  listProviderConfigs,
  saveProviderConfig,
  setInstanceProviderConfig,
  testProviderConfig,
} from ".";

const db = getTestDb();
const mock = testConfig({ llmMode: "mock" });
const deps = { db, config: mock };
const withConfig = (o: Parameters<typeof testConfig>[0]) => ({
  db,
  config: testConfig({ llmMode: "mock", ...o }),
});
const user = { userId: "u1", role: "user" as const };
const admin = { userId: "adm", role: "admin" as const };
const anthropic = {
  kind: "anthropic" as const,
  label: "Mine",
  apiKey: "sk-ant-test-abcd",
  models: { main: "claude-sonnet-5-5", fast: "claude-haiku-5-5" },
};
const local = {
  kind: "openai_compatible" as const,
  label: "Local",
  baseUrl: "http://127.0.0.1:8080/v1",
  apiKey: "local-key-9999",
  models: { main: "qwen", fast: "qwen" },
};
const row = async (id: string) =>
  (await db.select().from(schema.providerConfigs).where(eq(schema.providerConfigs.id, id)))[0];
const savedAndActive = async () => {
  const v = await saveProviderConfig(deps, user, { ...anthropic, scope: "user" });
  await testProviderConfig(deps, user, v.id);
  await activateProviderConfig(db, "u1", v.id);
  return v;
};

beforeEach(async () => {
  await resetDb(db);
  await ensureInstanceSettings(db);
  await seedUser(db, "u1");
  await seedUser(db, "u2");
  await seedUser(db, "adm", "admin");
});

describe("saving", () => {
  it("encrypts the key and only ever returns its last 4 characters", async () => {
    const v = await saveProviderConfig(deps, user, { ...anthropic, scope: "user" });
    expect(v).toMatchObject({
      scope: "user",
      kind: "anthropic",
      keyLast4: "abcd",
      status: "untested",
      authFailed: false,
    });
    expect(JSON.stringify([v, await listProviderConfigs(db, "u1")])).not.toMatch(/sk-ant-test|v1:/);
    expect(decryptSecret(loadKeyring(mock), (await row(v.id))?.encryptedKey ?? "", v.id)).toBe(
      "sk-ant-test-abcd",
    );
  });
  it("stores no last-4 for keys shorter than 8 characters", async () => {
    const v = await saveProviderConfig(deps, user, { ...anthropic, apiKey: "test", scope: "user" });
    expect(v.keyLast4).toBeNull();
  });
  it("applies a context window edit to tested capabilities without a retest", async () => {
    const v = await saveProviderConfig(deps, admin, { ...local, scope: "user" });
    await testProviderConfig(deps, admin, v.id);
    const edited = await saveProviderConfig(deps, admin, {
      ...local,
      apiKey: undefined,
      contextWindow: 32_000,
      id: v.id,
      scope: "user",
    });
    expect(edited).toMatchObject({
      status: "full",
      contextWindow: 32_000,
      capabilities: { contextWindow: 32_000 },
    });
  });
  it("rejects invalid input", async () => {
    for (const bad of [
      { ...anthropic, apiKey: undefined }, // key required for known providers
      { ...anthropic, baseUrl: "https://proxy.example/v1" }, // base URL only for custom endpoints
      { ...anthropic, models: { ...anthropic.models, embedding: "e" } }, // Anthropic has no embedding models
      { ...anthropic, label: "" },
      { ...anthropic, models: { main: "", fast: "x" } },
      { ...anthropic, contextWindow: 50_000 }, // only for custom endpoints
    ])
      await expect(
        saveProviderConfig(deps, user, { ...bad, scope: "user" }),
      ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      saveProviderConfig(deps, user, { ...anthropic, scope: "instance" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
  it("keeps the key when saved without one; only model or endpoint changes reset the status (Review Focus 5)", async () => {
    const v = await saveProviderConfig(deps, user, { ...anthropic, scope: "user" });
    await testProviderConfig(deps, user, v.id);
    const base = { ...anthropic, apiKey: undefined, id: v.id, scope: "user" as const };
    expect(await saveProviderConfig(deps, user, { ...base, label: "Renamed" })).toMatchObject({
      label: "Renamed",
      status: "full",
      keyLast4: "abcd",
    });
    expect(
      await saveProviderConfig(deps, user, {
        ...base,
        models: { main: "claude-opus-5-5", fast: "claude-haiku-5-5" },
      }),
    ).toMatchObject({ status: "untested", capabilities: null, keyLast4: "abcd" });
  });
  it("drops the stored key when the endpoint or kind changes (Review Focus 5)", async () => {
    const v = await saveProviderConfig(deps, admin, { ...local, scope: "user" });
    expect(
      await saveProviderConfig(deps, admin, {
        ...local,
        apiKey: undefined,
        baseUrl: "http://127.0.0.1:9090/v1",
        id: v.id,
        scope: "user",
      }),
    ).toMatchObject({ keyLast4: null, status: "untested" });
    expect((await row(v.id))?.encryptedKey).toBeNull();
    const a = await saveProviderConfig(deps, user, { ...anthropic, scope: "user" });
    await expect(
      saveProviderConfig(deps, user, {
        ...anthropic,
        kind: "openai",
        apiKey: undefined,
        id: a.id,
        scope: "user",
      }),
    ).rejects.toThrow(new ValidationError("Enter an API key."));
  });
});

describe("custom endpoints", () => {
  it("enforces CUSTOM_ENDPOINTS and the private-address rule (Review Focus 2)", async () => {
    await expect(
      saveProviderConfig(deps, user, { ...local, scope: "user" }),
    ).rejects.toBeInstanceOf(ForbiddenError); // admin_only
    const all = withConfig({ customEndpoints: "all" });
    for (const baseUrl of [
      "http://127.0.0.1:8080/v1",
      "http://169.254.169.254/v1",
      "http://[::ffff:127.0.0.1]:8080/v1",
    ]) {
      await expect(
        saveProviderConfig(all, user, { ...local, baseUrl, scope: "user" }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    }
    await expect(
      saveProviderConfig(all, user, {
        ...local,
        baseUrl: "http://93.184.215.14/v1",
        scope: "user",
      }),
    ).resolves.toMatchObject({ kind: "openai_compatible" });
  });
  it("re-checks the policy at test time (Review Focus 2)", async () => {
    const v = await saveProviderConfig(
      withConfig({ customEndpoints: "all", allowPrivateEndpoints: true }),
      user,
      { ...local, scope: "user" },
    );
    await expect(
      testProviderConfig(withConfig({ customEndpoints: "all" }), user, v.id),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect((await row(v.id))?.status).toBe("untested");
  });
});

describe("testing, activation, deletion", () => {
  it("refuses activation until a test passes", async () => {
    const v = await saveProviderConfig(deps, user, { ...anthropic, scope: "user" });
    await expect(activateProviderConfig(db, "u1", v.id)).rejects.toThrow(
      new ValidationError("Run a successful capability test before activating this provider."),
    );
    expect(await testProviderConfig(deps, user, v.id)).toMatchObject({
      status: "full",
      checks: { basic: { ok: true } },
      lastTestedAt: expect.any(Date),
    });
    await activateProviderConfig(db, "u1", v.id);
    expect((await getUserSettings(db, "u1")).providerConfigId).toBe(v.id);
    expect(await getProviderStatusForUser(db, "u1")).toEqual({
      source: "user",
      authFailed: false,
      status: "full",
    });
  });
  it("scopes every operation to the owner", async () => {
    const v = await saveProviderConfig(deps, user, { ...anthropic, scope: "user" });
    const other = { userId: "u2", role: "user" as const };
    await expect(testProviderConfig(deps, other, v.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(activateProviderConfig(db, "u2", v.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(deleteProviderConfig(db, "u2", v.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      saveProviderConfig(deps, other, { ...anthropic, id: v.id, scope: "user" }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(await listProviderConfigs(db, "u2")).toEqual([]);
  });
  it("a passing re-test clears a rejected key; a failing one deactivates (Review Focus 3)", async () => {
    const v = await savedAndActive();
    await markAuthFailed(db, v.id);
    expect(await getProviderStatusForUser(db, "u1")).toEqual({
      source: "user",
      authFailed: true,
      status: "degraded",
    });
    expect(await testProviderConfig(deps, user, v.id)).toMatchObject({
      status: "full",
      authFailed: false,
    });
    registerMockFixture("probe", () => {
      throw new Error("boom");
    });
    try {
      expect((await testProviderConfig(deps, user, v.id)).status).toBe("unsupported");
      expect((await getUserSettings(db, "u1")).providerConfigId).toBeNull();
    } finally {
      registerMockFixture("probe", probeFixture);
    }
  });
  it("deleting the active config deactivates it", async () => {
    const v = await savedAndActive();
    await deleteProviderConfig(db, "u1", v.id);
    expect((await getUserSettings(db, "u1")).providerConfigId).toBeNull();
  });
});

describe("instance provider", () => {
  it("is admin-only, updated in place, and reported as the user's source", async () => {
    expect(await getProviderStatusForUser(db, "u1")).toEqual({
      source: "none",
      authFailed: false,
      status: null,
    });
    await expect(setInstanceProviderConfig(deps, "u1", anthropic)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    const a = await setInstanceProviderConfig(deps, "adm", anthropic);
    const b = await setInstanceProviderConfig(deps, "adm", {
      ...anthropic,
      apiKey: undefined,
      label: "Team",
    });
    expect(b).toMatchObject({ id: a.id, scope: "instance", label: "Team", keyLast4: "abcd" });
    expect((await getInstanceProviderConfig(db, "adm"))?.label).toBe("Team");
    await expect(getInstanceProviderConfig(db, "u1")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(testProviderConfig(deps, user, a.id)).rejects.toBeInstanceOf(ForbiddenError);
    expect(await listProviderConfigs(db, "adm")).toEqual([]);
    await testProviderConfig(deps, admin, a.id);
    expect(await getProviderStatusForUser(db, "u1")).toEqual({
      source: "instance",
      authFailed: false,
      status: "full",
    });
  });
});
