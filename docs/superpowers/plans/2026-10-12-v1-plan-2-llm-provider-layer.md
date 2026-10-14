# Pathwise v1 · Plan 2: LLM Provider Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Users (and the admin, for the whole instance) can connect Anthropic, OpenAI, Google, or an OpenAI-compatible endpoint with their own key, run a capability test, and activate it. Core code gets one resolved `Llm` per user with structured-output fallbacks, usage tracking, auth-failure handling, and a deterministic mock mode so CI and E2E need no keys.

**Architecture:** `packages/core/src/crypto` encrypts provider keys (AES-256-GCM, keyring with key ids, rotation). `packages/core/src/llm` owns everything that touches the AI SDK: the provider factory, static capability tables, `resolveLlm`, the capability probe, `generateStructured` / `generateTextFor` / `embedTexts`, usage recording, and the mock models selected by `LLM_MODE=mock`. `services/providers`, `services/settings`, and `services/usage` are the user-scoped CRUD on top. `apps/web` adds `/settings`, two admin sections, and a provider banner; `apps/worker` adds the rotation CLI command.

**Tech Stack:** Plan 1's stack, plus Vercel AI SDK 7 (`ai`, `@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/google`, `@ai-sdk/openai-compatible`), `node:crypto`, `node:dns`, `node:net`.

**Spec:** [docs/superpowers/specs/2026-10-12-pathwise-design.md](../specs/2026-10-12-pathwise-design.md). This plan implements §4.4, the `provider_configs` / `user_settings` / `instance_settings` / `llm_usage` parts of §6.1 and §6.4, the provider-auth-failure behaviour of §7, the §9 rows "Provider 401/403", "Structured output invalid" (the repair retry), "No provider configured", and "Capability probe fails", the secrets and custom-endpoint parts of §10, and the `LLM_MODE=mock` part of §11. Cross-plan names come from the shared contract ([the plans 2–6 contract](2026-10-12-v1-plans-2-6-contract.md) §4).

**Cross-plan contract:** [2026-10-12-v1-plans-2-6-contract.md](2026-10-12-v1-plans-2-6-contract.md) fixes the names shared between Plans 2–6. This plan's *Interfaces* blocks refine it and take precedence.

## Spec gaps resolved

1. **No silent fallback.** Resolution picks the user's active config if set, else the instance config. If the picked config is unusable (`auth_failed`, `untested`, `unsupported`, or its key can't be decrypted), `resolveLlm` returns `null`. It does not fall through to the instance config, because that would quietly bill the admin's key for a user whose own key was revoked.
2. **Editing a config.** Saving without `apiKey` keeps the stored key. Changing `kind` or `baseUrl` drops the stored key unless a new one is supplied, so a key is never sent to a host it wasn't entered for. Any change to `kind`, `baseUrl`, the key, `models.main`, or `models.fast` resets `status` to `untested`, clears `capabilities`, and clears `auth_failed`.
3. **What the probe tests.** All four checks run against the `main` model. When `models.fast` differs, a `basic` check also runs against `fast`, and its failure fails `basic`, because a typo in the fast model id would otherwise break every background job.
4. **No forced tool choice in the probe.** Current Anthropic models (Opus 5.5, Sonnet 5.5) return HTTP 400 for forced `tool_choice`, so the `tools` check uses `toolChoice: "auto"` with an explicit instruction.
5. **Embedding provider.** `models.embeddingProviderConfigId` must reference a config with the same owner (the same user, or both instance-scope) whose kind is not `anthropic`. Anthropic has no embedding models, so an Anthropic config with `models.embedding` must name another provider for it. A dangling reference resolves to "no embedding model".
6. **`key_last4` column** (an addition to the contract's `provider_configs`): listing configs never needs to decrypt a key.
7. **"Run on save"** (spec §4.4): the web "Save and test" action calls `saveProviderConfig`, then `testProviderConfig`. Core keeps them separate so saving never depends on network reachability.
8. **Re-test results.** A re-test that passes clears `auth_failed`. A re-test of a user's active config that returns `unsupported` deactivates it (`user_settings.provider_config_id = null`).
9. **Instance key rejected.** Non-admin users see "The instance's AI provider key was rejected. Ask your admin to update it." instead of "Your API key was rejected", which would be wrong for them.
10. **Endpoint policy timing.** `CUSTOM_ENDPOINTS` and the private-address rule are enforced at save and again at probe time, not on every request. DNS rebinding after a successful probe is out of scope for v1.
11. **`ValidationError`** is added to `@pathwise/core/errors` (alongside the contract's `LlmUnavailableError`) for user-correctable input errors. Its message is user-facing copy.

## Global Constraints

- Versions: `ai` `7.0.x`, `@ai-sdk/anthropic` `4.x`, `@ai-sdk/openai` `4.x`, `@ai-sdk/google` `4.x`, `@ai-sdk/openai-compatible` `3.x`, `@ai-sdk/provider` (types, the version `ai` depends on). These are dependencies of `packages/core` only.
- Only files under `packages/core/src/llm/` import `ai` or `@ai-sdk/*`. Every other module calls `@pathwise/core/llm`, so usage is recorded and mock mode works. Later plans add two sanctioned exceptions (contract §9): Plan 4's `agent/` uses `ai` for tools, UI streams and the chat `streamText` (models still come from `Llm.model()`, and it records usage with `recordUsage`), and Plan 6's `telemetry/` registers `@ai-sdk/otel`.
- API keys: AES-256-GCM, 12-byte random IV, AAD = `provider_configs.id`, payload `v1:<keyId>:<iv>:<tag>:<ct>` (base64url parts). They are decrypted only in `packages/core` server code, never returned to the client (views carry `keyLast4` only), and never logged.
- No vendor fallback key exists. No env var supplies a provider key.
- `LLM_MODE` is `live` | `mock`, default `live`. Mock mode makes no network calls to LLM providers.
- CI and every test run without LLM API keys (AI SDK mock models / `LLM_MODE=mock`).
- Status rules (spec §4.4): `full` = all four checks pass; `degraded` = `basic` and `streaming` pass, at least one other fails; `unsupported` = `basic` or `streaming` fails. Only `full` and `degraded` configs can be activated or resolved, and only when `auth_failed` is false.
- Context window: static table for known model ids; `128000` for unknown models on known providers; custom endpoints use the user-entered value, default `8192`, and never the table.
- `pdfInput`: `true` for `anthropic`, `openai`, `google`; `false` for `openai_compatible`.
- Probe: 60-second timeout per check, `maxRetries: 0`, no forced tool choice.
- `CUSTOM_ENDPOINTS`: `off` = nobody; `admin_only` (default) = admins only; `all` = everyone, but non-admin base URLs must not resolve to private, loopback, link-local, unique-local, CGNAT, or unspecified addresses unless `ALLOW_PRIVATE_ENDPOINTS=true`. Admins are never subject to the private-address rule. A base URL is only allowed for `openai_compatible` and must be `http(s)`.
- Bluntness is 1–5, default 3. A `null` timezone means UTC.
- Logs carry ids, counts, and statuses only (spec §10), unless `config.logContent`.

## Review Focus

These are the five failure modes most likely to bite a real user. Each has a test in the task that owns the code:

1. **Key rotation crashes midway** (container killed after the new key is written, or after the DB commit but before the file swap) → every stored key stays decryptable by the running app, and re-running the command finishes the rotation. (Task 8)
2. **A non-admin points a custom endpoint at the host's network** (a hostname resolving to `127.0.0.1`, cloud metadata `169.254.169.254`, a name with one public and one private record, or an IPv4-mapped IPv6 literal such as `[::ffff:127.0.0.1]`) under `CUSTOM_ENDPOINTS=all` → rejected, at save and again at probe time. (Task 7)
3. **The user's key is revoked** → the first 401/403 marks the config `degraded` + `auth_failed`, `resolveLlm` returns `null` without falling back to the admin's instance key, and a passing re-test restores it. (Tasks 3, 5, and 7)
4. **A small local model returns JSON wrapped in prose or code fences, or invalid JSON** → the fallback strips fences, validates with Zod, repairs exactly once with the validation errors, then throws `StructuredOutputError`, with no endless retry loop. (Task 5)
5. **A user edits a saved config** → saving without re-entering the key keeps it; changing the endpoint drops the stored key so it is never sent to the new host; the key itself never reaches the browser. (Tasks 7 and 9)

---

## File structure

```
compose.yaml  .env.example  scripts/e2e.sh  playwright.config.ts  README.md   (modified)
test/integration/fixtures.ts                                                (testConfig, seedUser, insertConfig)
e2e/settings.spec.ts  e2e/instance-provider.spec.ts
packages/core/
  drizzle/0002_*.sql                                                        (generated)
  src/errors/index.ts                       (+ ValidationError, LlmUnavailableError)
  src/config/env.ts                         (+ llmMode)
  src/crypto/{secret.ts,keyring.ts,rotate.ts,index.ts}
  src/db/schema/{providers.ts,instance.ts,index.ts}
  src/llm/{types.ts,models.ts,factory.ts,resolve.ts,tokens.ts,usage.ts,auth.ts,generate.ts,probe.ts,index.ts}
  src/llm/mock/{registry.ts,model.ts,embedding.ts,index.ts}
  src/llm/mock/fixtures/{index.ts,probe.ts}
  src/services/settings/{service.ts,index.ts}
  src/services/providers/{endpoint-policy.ts,service.ts,index.ts}
  src/services/usage/{service.ts,index.ts}
apps/worker/src/cli.ts                      (+ admin rotate-encryption-key)
apps/web/src/components/{provider-banner.tsx,timezone-sync.tsx,provider-form.tsx,probe-results.tsx}
apps/web/src/components/app-nav.tsx         (+ Settings link)
apps/web/src/app/(app)/{layout.tsx,actions.ts}
apps/web/src/app/(app)/settings/{page.tsx,actions.ts,provider-list.tsx,coach-settings.tsx}
apps/web/src/app/(app)/admin/{page.tsx,actions.ts,instance-provider.tsx}
```

`@pathwise/core/llm` re-exports the mock API (`createMockModel`, `registerMockFixture`, `MockCall`, `MockReply`). `ai/test` has no test-runner dependencies, so mock mode works in the production image.

---

### Task 1: Secret encryption and keyring

**Files:**
- Create: `packages/core/src/crypto/{secret.ts,keyring.ts,index.ts}`
- Test: `packages/core/src/crypto/secret.test.ts`, `packages/core/src/crypto/keyring.test.ts`

**Interfaces:**
- Consumes: `AppConfig`, `decodeEncryptionKey` (`@pathwise/core/config`); `ConfigError`.
- Produces (`@pathwise/core/crypto`):
  ```ts
  export interface Keyring { current: Buffer; others: Buffer[] }
  export function keyId(key: Buffer): string;                // first 8 hex chars of sha256(key)
  export function encryptSecret(keyring: Keyring, plaintext: string, aad: string): string;
  export function decryptSecret(keyring: Keyring, payload: string, aad: string): string;
  export class SecretDecryptError extends Error {}           // malformed, wrong AAD, tampered, unknown key id
  export function loadKeyring(config: Pick<AppConfig, "appEncryptionKey" | "secretsDir">): Keyring;
  ```

- [ ] **Step 1: Write the failing tests**

  ```ts
  // packages/core/src/crypto/secret.test.ts
  import { randomBytes } from "node:crypto";
  import { describe, expect, it } from "vitest";
  import { decryptSecret, encryptSecret, keyId, SecretDecryptError } from "./secret";

  const k1 = Buffer.alloc(32, 1);
  const k2 = Buffer.alloc(32, 2);
  const ring = { current: k1, others: [] };
  const flip = (part = "") => { const b = Buffer.from(part, "base64url"); b[0] = (b[0] ?? 0) ^ 1; return b.toString("base64url"); };

  describe("encryptSecret / decryptSecret", () => {
    it("round-trips in the documented format with a fresh IV each time", () => {
      const p = encryptSecret(ring, "sk-ant-secret-1234", "cfg-1");
      expect(p).toMatch(/^v1:[0-9a-f]{8}:[\w-]+:[\w-]+:[\w-]+$/);
      expect(p.split(":")[1]).toBe(keyId(k1));
      expect(p).not.toContain("secret");
      expect(decryptSecret(ring, p, "cfg-1")).toBe("sk-ant-secret-1234");
      expect(encryptSecret(ring, "x", "a")).not.toBe(encryptSecret(ring, "x", "a"));
    });
    it("fails with the wrong AAD (a payload copied to another row)", () => {
      expect(() => decryptSecret(ring, encryptSecret(ring, "x", "cfg-1"), "cfg-2")).toThrow(SecretDecryptError);
    });
    it("fails when the ciphertext or the tag is tampered with", () => {
      const [v, id, iv, tag, ct] = encryptSecret(ring, "hello world", "a").split(":");
      expect(() => decryptSecret(ring, [v, id, iv, tag, flip(ct)].join(":"), "a")).toThrow(SecretDecryptError);
      expect(() => decryptSecret(ring, [v, id, iv, flip(tag), ct].join(":"), "a")).toThrow(SecretDecryptError);
    });
    it("decrypts with a non-current key chosen by key id", () => {
      const old = encryptSecret({ current: k2, others: [] }, "x", "a");
      expect(decryptSecret({ current: k1, others: [k2] }, old, "a")).toBe("x");
    });
    it("names the key id when the key is not in the keyring, and rejects malformed payloads", () => {
      const p = encryptSecret({ current: randomBytes(32), others: [] }, "x", "a");
      expect(() => decryptSecret(ring, p, "a")).toThrow(new RegExp(`key ${p.split(":")[1]}, which is not in the keyring`));
      expect(() => decryptSecret(ring, "sk-plaintext", "a")).toThrow(SecretDecryptError);
    });
  });
  ```

  ```ts
  // packages/core/src/crypto/keyring.test.ts
  import { mkdtempSync, writeFileSync } from "node:fs";
  import { tmpdir } from "node:os";
  import { join } from "node:path";
  import { expect, it } from "vitest";
  import { loadKeyring } from "./keyring";

  const k = (n: number) => Buffer.alloc(32, n);
  const dir = () => mkdtempSync(join(tmpdir(), "pw-ring-"));
  const put = (d: string, name: string, v: string) => writeFileSync(join(d, name), v, { mode: 0o600 });

  it("holds only the current key when no key files exist", () => {
    expect(loadKeyring({ appEncryptionKey: k(1), secretsDir: dir() })).toEqual({ current: k(1), others: [] });
  });
  it("adds distinct keys from APP_ENCRYPTION_KEY, .next and .previous, in that order", () => {
    const d = dir();
    put(d, "APP_ENCRYPTION_KEY", k(1).toString("base64"));
    put(d, "APP_ENCRYPTION_KEY.next", k(2).toString("base64"));
    put(d, "APP_ENCRYPTION_KEY.previous", k(3).toString("base64"));
    expect(loadKeyring({ appEncryptionKey: k(1), secretsDir: d })).toEqual({ current: k(1), others: [k(2), k(3)] });
    // A process started before a rotation swapped the files still reads every key.
    expect(loadKeyring({ appEncryptionKey: k(3), secretsDir: d }).others).toEqual([k(1), k(2)]);
  });
  it("fails loudly on a corrupt key file", () => {
    const d = dir();
    put(d, "APP_ENCRYPTION_KEY.next", "short");
    expect(() => loadKeyring({ appEncryptionKey: k(1), secretsDir: d })).toThrow(/APP_ENCRYPTION_KEY\.next/);
  });
  ```

- [ ] **Step 2: Run tests to verify they fail**

  Run: `pnpm test packages/core/src/crypto`
  Expected: FAIL. Cannot resolve `./secret` / `./keyring`.

- [ ] **Step 3: Implement**

  - `encryptSecret`: `createCipheriv("aes-256-gcm", current, iv)` with `iv = randomBytes(12)` and `setAAD(Buffer.from(aad, "utf8"))`, then join `["v1", keyId(current), iv, tag, ct]` with base64url parts.
  - `decryptSecret`: the payload needs exactly 5 parts with `v1` first, else `SecretDecryptError("Malformed encrypted secret")`. Pick the key in `[current, ...others]` whose `keyId` matches. If none matches, throw `SecretDecryptError("Secret was encrypted with key <id>, which is not in the keyring. Restore the pathwise-secrets volume or re-enter the API key.")`. A GCM failure → `SecretDecryptError("Encrypted secret failed authentication")`.
  - `loadKeyring`: read `APP_ENCRYPTION_KEY`, `.next`, `.previous` from `secretsDir`, in that order, when they exist, using `decodeEncryptionKey`. A decode failure → `ConfigError("Key file <path> is invalid: …")`. Keep the keys that differ from `current` and from each other. It reads the files on every call, so long-running processes see rotation files without a restart.

- [ ] **Step 4: Run tests**

  Run: `pnpm test packages/core/src/crypto && pnpm lint`
  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add packages/core/src/crypto
  git commit -m "feat: add AES-256-GCM secret encryption with keyring"
  ```

---

### Task 2: Provider schema, LLM_MODE, user settings service

**Files:**
- Create: `packages/core/src/db/schema/providers.ts`, `packages/core/src/llm/types.ts`, `packages/core/src/services/settings/{service.ts,index.ts}`, `test/integration/fixtures.ts`, `packages/core/drizzle/0002_*.sql` (generated)
- Modify: `packages/core/src/db/schema/{instance.ts,index.ts}`, `packages/core/src/errors/index.ts`, `packages/core/src/config/env.ts`, `compose.yaml`, `.env.example`
- Test: `packages/core/src/config/env.test.ts`, `packages/core/src/services/settings/service.int.test.ts`

**Interfaces:**
- Consumes: `Db`, `schema.user` (Plan 1).
- Produces:
  ```ts
  // @pathwise/core/config: BaseConfig gains `llmMode: "live" | "mock"`
  // @pathwise/core/errors
  export class ValidationError extends Error {}               // message is user-facing copy
  export type LlmUnavailableReason = "none" | "auth_failed" | "unusable";
  export class LlmUnavailableError extends Error { readonly reason: LlmUnavailableReason }   // constructor(reason)
  // @pathwise/core/llm (types.ts): ProviderKind, ModelRole, ProviderStatus, Capabilities, LlmPurpose, Llm, LlmDeps exactly as contract §4, plus
  export interface ProviderModels { main: string; fast: string; embedding?: string; embeddingProviderConfigId?: string }
  export type ProbeCheckName = "basic" | "streaming" | "tools" | "jsonSchema";
  export type ProbeChecks = Record<ProbeCheckName, { ok: boolean; error?: string }>;
  // @pathwise/core/services/settings: UserSettings, getUserSettings, updateUserSettings, effectiveTimezone (contract §4)
  // test/integration/fixtures.ts
  export function testConfig(overrides?: Partial<AppConfig>): AppConfig;   // BaseConfig defaults, llmMode "live", key Buffer.alloc(32, 1), fresh temp secretsDir
  export function seedUser(db: Db, id: string, role?: "admin" | "user"): Promise<void>; // name = id, email = `${id}@x.io`
  ```

- [ ] **Step 1: Add the schema and generate the migration**

  `schema/providers.ts`:
  - **`provider_configs`** (`providerConfigs`):
    - `id uuid pk defaultRandom`
    - `user_id text references user(id) on delete cascade`, nullable (null = instance-scope), indexed
    - `kind text not null`, check `in ('anthropic','openai','google','openai_compatible')`
    - `label text not null`, `base_url text`, `encrypted_key text`, `key_last4 text`
    - `models jsonb not null` (`$type<ProviderModels>()`), `context_window integer`, `capabilities jsonb` (`$type<Capabilities>()`)
    - `status text not null default 'untested'`, check `in ('untested','full','degraded','unsupported')`
    - `auth_failed boolean not null default false`, `last_tested_at timestamptz`, `created_at`/`updated_at timestamptz not null default now()`
  - **`user_settings`** (`userSettings`):
    - `user_id text pk references user(id) on delete cascade`
    - `provider_config_id uuid references provider_configs(id) on delete set null`
    - `bluntness smallint not null default 3`, check `between 1 and 5`
    - `timezone text`
    - `checkin_enabled boolean not null default true`, `checkin_day smallint not null default 0` (check `between 0 and 6`), `checkin_time text not null default '18:00'`, `email_enabled boolean not null default true`
    - `profile_version integer not null default 0`, `created_at`, `updated_at`
  - **`llm_usage`** (`llmUsage`):
    - `id uuid pk defaultRandom`, `user_id text not null references user(id) on delete cascade`
    - `provider_config_id uuid references provider_configs(id) on delete set null`
    - `model text not null`, `role text not null` (check `in ('main','fast','embedding')`), `purpose text not null`
    - `input_tokens integer not null`, `output_tokens integer not null`, `created_at timestamptz not null default now()`
    - indexes on `(user_id, created_at)` and `(created_at)`
  - **`instance.ts`:** add `instance_provider_config_id uuid references provider_configs(id) on delete set null` to `instance_settings`.

  Run: `pnpm --filter @pathwise/core db:generate`
  Expected: `drizzle/0002_*.sql` creates the three tables with their checks and adds the instance column.

- [ ] **Step 2: Write the failing tests**

  In `env.test.ts`, add `llmMode: "live"` to the `applies defaults` expectation, and add:

  ```ts
  it("reads LLM_MODE", () => {
    expect(loadBaseConfig({ ...DB, LLM_MODE: "mock" }).llmMode).toBe("mock");
    expect(loadBaseConfig({ ...DB, LLM_MODE: "" }).llmMode).toBe("live");
    expect(() => loadBaseConfig({ ...DB, LLM_MODE: "fake" })).toThrow(/LLM_MODE/);
  });
  ```

  ```ts
  // packages/core/src/services/settings/service.int.test.ts
  import { beforeEach, describe, expect, it } from "vitest";
  import { getTestDb, resetDb } from "../../../../../test/integration/db";
  import { seedUser } from "../../../../../test/integration/fixtures";
  import { schema } from "../../db";
  import { ValidationError } from "../../errors";
  import { effectiveTimezone, getUserSettings, updateUserSettings } from ".";

  const db = getTestDb();
  beforeEach(async () => { await resetDb(db); await seedUser(db, "u1"); });

  describe("user settings", () => {
    it("creates defaults lazily, exactly once, and treats a missing timezone as UTC", async () => {
      const [a, b] = await Promise.all([getUserSettings(db, "u1"), getUserSettings(db, "u1")]);
      expect(a).toEqual({ providerConfigId: null, bluntness: 3, timezone: null, checkinEnabled: true,
        checkinDay: 0, checkinTime: "18:00", emailEnabled: true, profileVersion: 0 });
      expect(b).toEqual(a);
      expect(await db.select().from(schema.userSettings)).toHaveLength(1);
      expect(effectiveTimezone(a)).toBe("UTC");
    });
    it("updates bluntness and timezone, and clears the timezone with null", async () => {
      expect(await updateUserSettings(db, "u1", { bluntness: 5, timezone: "Europe/Berlin" })).toMatchObject({ bluntness: 5, timezone: "Europe/Berlin" });
      expect((await updateUserSettings(db, "u1", { timezone: null })).timezone).toBeNull();
    });
    it.each([0, 6, 2.5])("rejects bluntness %s", async (bluntness) => {
      await expect(updateUserSettings(db, "u1", { bluntness: bluntness as 1 })).rejects.toBeInstanceOf(ValidationError);
    });
    it.each(["Mars/Olympus", "+01:00", "", "Europe/Berlin; drop table x"])("rejects timezone %j", async (tz) => {
      await expect(updateUserSettings(db, "u1", { timezone: tz })).rejects.toBeInstanceOf(ValidationError);
    });
  });
  ```

- [ ] **Step 3: Run tests to verify they fail**

  Run: `pnpm test packages/core/src/config && pnpm test:int packages/core/src/services/settings`
  Expected: FAIL. `llmMode` missing; `services/settings` and `fixtures` not found.

- [ ] **Step 4: Implement**

  - `env.ts`: `LLM_MODE: optional(z.enum(["live", "mock"]))` → `llmMode: e.LLM_MODE ?? "live"`. `compose.yaml` `x-app-env`: `LLM_MODE: ${LLM_MODE:-live}`. `.env.example`: `# "live" calls the configured LLM providers; "mock" uses deterministic fake models (tests and demos only).` + `# LLM_MODE=live`.
  - `getUserSettings`: `insert … values({ userId }) on conflict do nothing`, then select.
  - `updateUserSettings`:
    - Bluntness: an integer 1–5, else `ValidationError("Bluntness must be a whole number from 1 to 5.")`.
    - Timezone: must match `/^[A-Za-z]+(?:\/[A-Za-z0-9_+-]+)*$/` and be accepted by `new Intl.DateTimeFormat("en-US", { timeZone })`, else `ValidationError("Unknown timezone.")`. The regex excludes offset zones like `+01:00`, which recent V8 accepts.
    - Store the value as given and set `updated_at`.
  - `fixtures.ts`: `testConfig` uses `databaseUrl: inject("databaseUrl")`; `seedUser` inserts with `emailVerified: false`.

- [ ] **Step 5: Run tests**

  Run: `pnpm test && pnpm test:int && pnpm typecheck`
  Expected: PASS.

- [ ] **Step 6: Commit**

  ```bash
  git add -A
  git commit -m "feat: add provider schema, LLM_MODE, and user settings service"
  ```

---

### Task 3: Provider factory, capability tables, resolveLlm

**Files:**
- Create: `packages/core/src/llm/{models.ts,factory.ts,resolve.ts,index.ts}`
- Modify: `packages/core/package.json` (deps `ai`, `@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/google`, `@ai-sdk/openai-compatible`, `@ai-sdk/provider`), `test/integration/fixtures.ts`
- Test: `packages/core/src/llm/models.test.ts`, `packages/core/src/llm/resolve.int.test.ts`

**Interfaces:**
- Consumes: `loadKeyring`, `decryptSecret`, `SecretDecryptError` (Task 1); schema, types, `LlmUnavailableError` (Task 2).
- Produces (`@pathwise/core/llm`):
  ```ts
  export const CONTEXT_WINDOWS: Record<string, number>;
  export const MODEL_SUGGESTIONS: Record<Exclude<ProviderKind, "openai_compatible">, { main: string; fast: string; embedding?: string }>;
  export function staticPdfInput(kind: ProviderKind): boolean;
  export function contextWindowFor(kind: ProviderKind, modelId: string, userEntered: number | null): number;
  export interface ProviderTarget { id: string; kind: ProviderKind; baseUrl: string | null; apiKey: string | null; models: ProviderModels; contextWindow: number | null; capabilities: Capabilities | null }
  export function createLanguageModel(config: Pick<AppConfig, "llmMode">, target: ProviderTarget, role: "main" | "fast", purpose: LlmPurpose, opts?: { structuredOutputs?: boolean }): LanguageModel;
  export function createEmbeddingModel(config: Pick<AppConfig, "llmMode">, target: ProviderTarget): EmbeddingModel | null;
  export function resolveLlm(deps: LlmDeps, userId: string): Promise<Llm | null>;
  export function requireLlm(deps: LlmDeps, userId: string): Promise<Llm>;        // throws LlmUnavailableError(reason) instead of returning null
  // test/integration/fixtures.ts
  export const FULL_CAPS: Capabilities;  // all checks true, pdfInput true, contextWindow 128000
  export function insertConfig(db: Db, config: AppConfig, row: { userId: string | null; kind?: ProviderKind; baseUrl?: string; status?: ProviderStatus; authFailed?: boolean; apiKey?: string; models?: ProviderModels }): Promise<string>;
  // defaults: kind "openai", status "full", authFailed false, apiKey "sk-test-key-1234", models { main: "m-main", fast: "m-fast" },
  // capabilities FULL_CAPS (null when untested). Pre-generates the id, encrypts with { current: config.appEncryptionKey, others: [] }
  // and AAD = id; apiKey "" stores no key.
  ```

- [ ] **Step 1: Write the failing tests**

  ```ts
  // packages/core/src/llm/models.test.ts
  import type { LanguageModelV4 } from "@ai-sdk/provider";
  import { describe, expect, it } from "vitest";
  import { createEmbeddingModel, createLanguageModel } from "./factory";
  import { CONTEXT_WINDOWS, contextWindowFor, MODEL_SUGGESTIONS, staticPdfInput } from "./models";
  import type { ProviderKind } from "./types";

  const target = (kind: ProviderKind, embedding?: string) => ({
    id: "cfg", kind, apiKey: "k", contextWindow: null, capabilities: null,
    baseUrl: kind === "openai_compatible" ? "http://127.0.0.1:8080/v1" : null,
    models: { main: "m-main", fast: "m-fast", embedding },
  });

  describe("static capability tables", () => {
    it.each([["anthropic", true], ["openai", true], ["google", true], ["openai_compatible", false]] as const)(
      "pdfInput for %s is %s", (kind, expected) => expect(staticPdfInput(kind)).toBe(expected));
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
      for (const s of Object.values(MODEL_SUGGESTIONS)) for (const id of [s.main, s.fast]) expect(CONTEXT_WINDOWS[id]).toBeGreaterThan(0);
    });
  });

  describe("createLanguageModel (live)", () => {
    it.each([["anthropic", /^anthropic/], ["openai", /^openai/], ["google", /^google/], ["openai_compatible", /^custom/]] as const)(
      "builds a %s model with the role's model id", (kind, provider) => {
        const m = createLanguageModel({ llmMode: "live" }, target(kind), "fast", "test") as LanguageModelV4;
        expect(m.modelId).toBe("m-fast");
        expect(m.provider).toMatch(provider);
      });
    it("has no embedding model without models.embedding, and none for Anthropic", () => {
      expect(createEmbeddingModel({ llmMode: "live" }, target("openai"))).toBeNull();
      expect(createEmbeddingModel({ llmMode: "live" }, target("anthropic", "e"))).toBeNull();
      expect(createEmbeddingModel({ llmMode: "live" }, target("openai", "e"))).not.toBeNull();
    });
  });
  ```

  ```ts
  // packages/core/src/llm/resolve.int.test.ts
  import type { LanguageModelV4 } from "@ai-sdk/provider";
  import { beforeEach, describe, expect, it } from "vitest";
  import { getTestDb, resetDb } from "../../../../test/integration/db";
  import { insertConfig, seedUser, testConfig } from "../../../../test/integration/fixtures";
  import { schema } from "../db";
  import { ensureInstanceSettings } from "../instance";
  import { requireLlm, resolveLlm } from "./resolve";

  const db = getTestDb();
  const config = testConfig();
  const deps = { db, config };
  const activate = (userId: string, id: string) => db.insert(schema.userSettings).values({ userId, providerConfigId: id })
    .onConflictDoUpdate({ target: schema.userSettings.userId, set: { providerConfigId: id } });
  const setInstance = (id: string) => db.update(schema.instanceSettings).set({ instanceProviderConfigId: id });

  beforeEach(async () => { await resetDb(db); await ensureInstanceSettings(db); await seedUser(db, "u1"); });

  describe("resolveLlm", () => {
    it("returns null when nothing is configured", async () => {
      expect(await resolveLlm(deps, "u1")).toBeNull();
      await expect(requireLlm(deps, "u1")).rejects.toMatchObject({ name: "LlmUnavailableError", reason: "none" });
    });
    it("uses the user's active config", async () => {
      const id = await insertConfig(db, config, { userId: "u1", kind: "anthropic", models: { main: "claude-sonnet-5-5", fast: "claude-haiku-5-5" } });
      await activate("u1", id);
      const llm = await resolveLlm(deps, "u1");
      expect(llm).toMatchObject({ userId: "u1", providerConfigId: id, kind: "anthropic", embedding: null });
      expect(llm?.modelId("main")).toBe("claude-sonnet-5-5");
      expect(llm?.modelId("embedding")).toBeNull();
      expect((llm?.model("fast", "test") as LanguageModelV4).modelId).toBe("claude-haiku-5-5");
    });
    it("falls back to the instance config when the user has none", async () => {
      const id = await insertConfig(db, config, { userId: null });
      await setInstance(id);
      expect((await resolveLlm(deps, "u1"))?.providerConfigId).toBe(id);
    });
    it("does not fall back to the instance key when the user's key was rejected (Review Focus 3)", async () => {
      await setInstance(await insertConfig(db, config, { userId: null }));
      await activate("u1", await insertConfig(db, config, { userId: "u1", status: "degraded", authFailed: true }));
      expect(await resolveLlm(deps, "u1")).toBeNull();
      await expect(requireLlm(deps, "u1")).rejects.toMatchObject({ reason: "auth_failed" });
    });
    it.each(["untested", "unsupported"] as const)("returns null for a %s config", async (status) => {
      await activate("u1", await insertConfig(db, config, { userId: "u1", status }));
      expect(await resolveLlm(deps, "u1")).toBeNull();
    });
    it("returns null instead of throwing when the key cannot be decrypted", async () => {
      await activate("u1", await insertConfig(db, testConfig({ appEncryptionKey: Buffer.alloc(32, 9) }), { userId: "u1" }));
      expect(await resolveLlm(deps, "u1")).toBeNull();
      await expect(requireLlm(deps, "u1")).rejects.toMatchObject({ reason: "unusable" });
    });
    it("takes the embedding model from the embedding provider config", async () => {
      const emb = await insertConfig(db, config, { userId: "u1", kind: "openai_compatible", baseUrl: "http://127.0.0.1:8081/v1",
        apiKey: "", models: { main: "x", fast: "x", embedding: "nomic-embed" } });
      const id = await insertConfig(db, config, { userId: "u1", kind: "anthropic",
        models: { main: "a", fast: "b", embedding: "nomic-embed", embeddingProviderConfigId: emb } });
      await activate("u1", id);
      expect((await resolveLlm(deps, "u1"))?.embedding).toMatchObject({ modelId: "nomic-embed", providerConfigId: emb });
    });
  });
  ```

- [ ] **Step 2: Run tests to verify they fail**

  Run: `pnpm test packages/core/src/llm && pnpm test:int packages/core/src/llm`
  Expected: FAIL. Modules not found.

- [ ] **Step 3: Implement**

  - **`models.ts`:**
    - `MODEL_SUGGESTIONS.anthropic = { main: "claude-sonnet-5-5", fast: "claude-haiku-5-5" }`. For `openai` and `google`, take the current flagship (main), small (fast), and embedding model ids from the providers' model documentation at implementation time.
    - `CONTEXT_WINDOWS` covers every suggested id: `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5` are all `1_000_000`; OpenAI and Google values come from the same docs.
    - `contextWindowFor`: `openai_compatible` → `userEntered ?? 8192`; otherwise `CONTEXT_WINDOWS[modelId] ?? 128_000`.
  - **`factory.ts`** (live branch; Task 4 adds mock):
    - `anthropic` → `createAnthropic({ apiKey })(id)`; `openai` → `createOpenAI({ apiKey })(id)`; `google` → `createGoogleGenerativeAI({ apiKey })(id)`.
    - `openai_compatible` → `createOpenAICompatible({ name: "custom", baseURL, apiKey: apiKey || undefined, supportsStructuredOutputs: opts?.structuredOutputs ?? capabilities?.jsonSchema ?? false }).chatModel(id)`.
    - `createEmbeddingModel` uses `.embeddingModel(models.embedding)` on openai / google / openai-compatible. It returns `null` for anthropic or when `models.embedding` is unset.
  - **`resolve.ts`:**
    1. Read `user_settings.provider_config_id` (without inserting). If null, read `instance_settings.instance_provider_config_id`. Both null → reason `none`.
    2. Load that row. `auth_failed` → reason `auth_failed`; status not `full`/`degraded` → reason `unusable`.
    3. Decrypt with `loadKeyring(deps.config)` and AAD = row id. A `SecretDecryptError` logs `{ providerConfigId }` at `warn` → reason `unusable`.
    4. Build the `Llm`:
       - `capabilities` = row.capabilities.
       - `model(role, purpose)` → `createLanguageModel` (purpose matters only in mock mode).
       - `modelId("embedding")` → the embedding model id or `null`.
       - Embedding target: `models.embeddingProviderConfigId`'s row if set (same owner, not auth-failed, decryptable), else the same row. Anything missing → `embedding: null`.
    - `resolveLlm` returns `null` for every reason; `requireLlm` throws `LlmUnavailableError(reason)`.

- [ ] **Step 4: Run tests**

  Run: `pnpm test packages/core/src/llm && pnpm test:int packages/core/src/llm && pnpm typecheck`
  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add -A
  git commit -m "feat: add provider factory, capability tables, and resolveLlm"
  ```

---

### Task 4: Mock mode

**Files:**
- Create: `packages/core/src/llm/mock/{registry.ts,model.ts,embedding.ts,index.ts}`, `packages/core/src/llm/mock/fixtures/index.ts`, `packages/core/src/llm/tokens.ts`
- Modify: `packages/core/src/llm/factory.ts` (mock branch), `packages/core/src/llm/index.ts`
- Test: `packages/core/src/llm/mock/model.test.ts`

**Interfaces:**
- Consumes: `createLanguageModel`, `createEmbeddingModel` (Task 3).
- Produces (`@pathwise/core/llm`): `MockCall`, `MockReply`, `registerMockFixture`, `createMockModel` exactly as contract §4, plus `createMockEmbeddingModel(modelId: string): EmbeddingModel` and `estimateTokens(text: string): number` (`Math.ceil(text.length / 4)`).

- [ ] **Step 1: Write the failing tests**

  ```ts
  // packages/core/src/llm/mock/model.test.ts
  import type { LanguageModelV4 } from "@ai-sdk/provider";
  import { embedMany, generateText, isStepCount, Output, streamText, tool } from "ai";
  import { describe, expect, it } from "vitest";
  import { z } from "zod";
  import { createEmbeddingModel, createLanguageModel } from "../factory";
  import type { ProviderKind } from "../types";
  import { createMockEmbeddingModel, createMockModel, type MockCall, registerMockFixture } from ".";

  const target = (kind: ProviderKind) => ({ id: "cfg", kind, apiKey: "k", baseUrl: null, contextWindow: null,
    capabilities: null, models: { main: "m-main", fast: "m-fast", embedding: "e" } });

  describe("mock language model", () => {
    it("falls back to the default fixture and reports usage", async () => {
      const r = await generateText({ model: createMockModel("fast", "unregistered"), prompt: "hi" });
      expect(r.text).toBe("Mock reply.");
      expect(r.usage.inputTokens).toBeGreaterThan(0);
    });
    it("passes purpose, role, last user text, system and tool names to the fixture", async () => {
      let seen: MockCall | undefined;
      registerMockFixture("t.capture", (c) => { seen = c; return { text: "ok" }; });
      await generateText({ model: createMockModel("main", "t.capture"), instructions: "Be kind.",
        messages: [{ role: "user", content: "first" }, { role: "assistant", content: "a" }, { role: "user", content: "second" }],
        tools: { lookup: tool({ inputSchema: z.object({}) }) } });
      expect(seen).toEqual({ purpose: "t.capture", role: "main", lastUserText: "second", system: "Be kind.", toolNames: ["lookup"] });
    });
    it("streams text in at least two chunks, even a single word", async () => {
      for (const text of ["Hello there, friend", "Hi"]) {
        registerMockFixture("t.stream", () => ({ text }));
        const chunks: string[] = [];
        for await (const d of streamText({ model: createMockModel("main", "t.stream"), prompt: "x" }).textStream) chunks.push(d);
        expect(chunks.length).toBeGreaterThanOrEqual(2);
        expect(chunks.join("")).toBe(text);
      }
    });
    it("returns JSON replies that satisfy Output.object", async () => {
      registerMockFixture("t.json", () => ({ json: { city: "Paris" } }));
      const r = await generateText({ model: createMockModel("fast", "t.json"), prompt: "x", output: Output.object({ schema: z.object({ city: z.string() }) }) });
      expect(r.output).toEqual({ city: "Paris" });
    });
    it("calls tools, then answers with the reply text after the tool result", async () => {
      registerMockFixture("t.tools", () => ({ toolCalls: [{ toolName: "add", input: { a: 2, b: 3 } }], text: "The sum is 5." }));
      const r = await generateText({ model: createMockModel("main", "t.tools"), prompt: "add", stopWhen: isStepCount(3),
        tools: { add: tool({ inputSchema: z.object({ a: z.number(), b: z.number() }), execute: async ({ a, b }) => a + b }) } });
      expect(r.steps[0]?.toolCalls[0]).toMatchObject({ toolName: "add", input: { a: 2, b: 3 } });
      expect(r.steps).toHaveLength(2);
      expect(r.text).toBe("The sum is 5.");
    });
  });

  describe("mock embeddings and LLM_MODE=mock", () => {
    it("produces deterministic 8-dimensional unit vectors", async () => {
      const { embeddings } = await embedMany({ model: createMockEmbeddingModel("e"), values: ["a", "a", "b"] });
      expect(embeddings[0]).toHaveLength(8);
      expect(embeddings[0]).toEqual(embeddings[1]);
      expect(embeddings[0]).not.toEqual(embeddings[2]);
      expect(Math.hypot(...(embeddings[0] ?? []))).toBeCloseTo(1, 6);
    });
    it("swaps every provider kind for mock models", () => {
      for (const kind of ["anthropic", "openai", "google", "openai_compatible"] as const) {
        expect((createLanguageModel({ llmMode: "mock" }, target(kind), "main", "chat") as LanguageModelV4).provider).toBe("mock");
      }
      expect(createEmbeddingModel({ llmMode: "mock" }, target("anthropic"))).not.toBeNull();
    });
  });
  ```

- [ ] **Step 2: Run tests to verify they fail**

  Run: `pnpm test packages/core/src/llm/mock`
  Expected: FAIL. `.` exports not found.

- [ ] **Step 3: Implement**

  - **`registry.ts`:** a `Map`. `registerMockFixture` replaces an existing entry. Lookup is exact purpose → `"*"` → built-in default `{ text: "Mock reply." }`.
  - **`model.ts`:** `createMockModel(role, purpose)` returns `new MockLanguageModelV4({ provider: "mock", modelId: \`mock-${role}\`, doGenerate, doStream })` and imports `./fixtures` for its side effects. Per call:
    1. Build `MockCall`: `lastUserText` = the last `user` message's text parts joined with `""`; `system` = the `system` messages joined with `"\n"`; `toolNames` = `options.tools` names.
    2. Run the fixture. Errors it throws propagate (tests use this to simulate a provider failure).
    3. Map the reply to content:
       - When the last prompt message has role `tool`: text = the reply's `text` property, or `"Mock reply."`.
       - `{ toolCalls }`: only `tool-call` parts (`toolCallId: "mock-call-<i>"`, `input: JSON.stringify(input)`), finish reason `tool-calls`.
       - `{ json }`: text `JSON.stringify(json)`.
       - `{ text }`: that text.
    4. Usage: `inputTokens.total = estimateTokens(all prompt text)`, `outputTokens.total = estimateTokens(output text)`.
    5. `doStream` emits the same content through `simulateReadableStream`. Text is split with `/(?<= )/`, or at its midpoint when that yields fewer than two pieces, and each piece is its own `text-delta`, followed by `finish`.
  - **`embedding.ts`:** `MockEmbeddingModelV4` whose `doEmbed` maps each value to bytes 0–7 of `sha256(value)` → `b / 127.5 - 1`, L2-normalized; usage `tokens` = the sum of `estimateTokens`.
  - **`fixtures/index.ts`:** imports each fixture module (Task 6 adds `probe.ts`; later plans add theirs).
  - **`factory.ts`:** when `config.llmMode === "mock"`, `createLanguageModel` returns `createMockModel(role, purpose)` and `createEmbeddingModel` returns `createMockEmbeddingModel(models.embedding)` whenever `models.embedding` is set (any kind). Neither needs the key.

- [ ] **Step 4: Run tests**

  Run: `pnpm test packages/core/src/llm`
  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add -A
  git commit -m "feat: add deterministic mock models behind LLM_MODE=mock"
  ```

---

### Task 5: Structured output, text and embedding helpers, usage, auth failures

**Files:**
- Create: `packages/core/src/llm/{usage.ts,auth.ts,generate.ts}`
- Modify: `packages/core/src/llm/index.ts`
- Test: `packages/core/src/llm/generate.test.ts`, `packages/core/src/llm/generate.int.test.ts`

**Interfaces:**
- Consumes: `Llm`, `LlmDeps` (Task 2); `estimateTokens` (Task 4); `insertConfig`, `FULL_CAPS` (Task 3).
- Produces (`@pathwise/core/llm`): `generateStructured`, `generateTextFor`, `embedTexts`, `recordUsage`, `isAuthError`, `markAuthFailed`, `StructuredOutputError` exactly as contract §4, plus the pure helper `parseJsonReply<T>(text: string, schema: z.ZodType<T>): { ok: true; value: T } | { ok: false; issues: string[] }`.

- [ ] **Step 1: Write the failing tests**

  ```ts
  // packages/core/src/llm/generate.test.ts
  import { APICallError, RetryError } from "ai";
  import { describe, expect, it } from "vitest";
  import { z } from "zod";
  import { isAuthError } from "./auth";
  import { parseJsonReply } from "./generate";

  const Person = z.object({ name: z.string(), years: z.number().int() });
  const apiError = (statusCode: number) => new APICallError({ message: "x", url: "https://api.example", requestBodyValues: {}, statusCode });

  describe("parseJsonReply", () => {
    it.each(['{"name":"Ada","years":3}', '```json\n{"name":"Ada","years":3}\n```', 'Sure! Here it is:\n{"name":"Ada","years":3}\nHope that helps.'])(
      "accepts %j", (text) => expect(parseJsonReply(text, Person)).toEqual({ ok: true, value: { name: "Ada", years: 3 } }));
    it("reports Zod issues with their paths, and invalid JSON", () => {
      expect(parseJsonReply('{"name":"Ada","years":2.5}', Person)).toEqual({ ok: false, issues: [expect.stringMatching(/^years: /)] });
      expect(parseJsonReply("{name: Ada", Person)).toEqual({ ok: false, issues: [expect.stringMatching(/^Reply is not valid JSON/)] });
    });
  });

  it("isAuthError recognises 401 and 403, directly or as a retry's last error", () => {
    expect(isAuthError(apiError(401))).toBe(true);
    expect(isAuthError(apiError(403))).toBe(true);
    expect(isAuthError(new RetryError({ message: "r", reason: "maxRetriesExceeded", errors: [apiError(401)] }))).toBe(true);
    expect(isAuthError(apiError(429))).toBe(false);
    expect(isAuthError(new Error("401"))).toBe(false);
  });
  ```

  ```ts
  // packages/core/src/llm/generate.int.test.ts
  import { APICallError } from "ai";
  import { MockEmbeddingModelV4, MockLanguageModelV4, mockValues } from "ai/test";
  import { eq } from "drizzle-orm";
  import { beforeEach, describe, expect, it } from "vitest";
  import { z } from "zod";
  import { getTestDb, resetDb } from "../../../../test/integration/db";
  import { FULL_CAPS, insertConfig, seedUser, testConfig } from "../../../../test/integration/fixtures";
  import { schema } from "../db";
  import { embedTexts, generateStructured, generateTextFor, StructuredOutputError } from "./generate";
  import type { Llm } from "./types";

  const db = getTestDb();
  const config = testConfig();
  const deps = { db, config };
  const Person = z.object({ name: z.string(), years: z.number().int() });
  const usage = (i?: number, o?: number) => ({ inputTokens: { total: i, noCache: i, cacheRead: undefined, cacheWrite: undefined },
    outputTokens: { total: o, text: o, reasoning: undefined } });
  const reply = (text: string, i: number | undefined = 10, o: number | undefined = 20) => ({ content: [{ type: "text" as const, text }],
    finishReason: { unified: "stop" as const, raw: undefined }, usage: usage(i, o), warnings: [] });
  function scripted(...results: (ReturnType<typeof reply> | Error)[]) {
    const next = mockValues(...results);
    return new MockLanguageModelV4({ modelId: "m", doGenerate: async () => { const r = next(); if (r instanceof Error) throw r; return r; } });
  }
  let cfgId: string;
  const llmFor = (model: MockLanguageModelV4, jsonSchema: boolean, embedding: Llm["embedding"] = null): Llm => ({
    userId: "u1", providerConfigId: cfgId, kind: "openai_compatible", capabilities: { ...FULL_CAPS, jsonSchema },
    model: () => model, modelId: (r) => (r === "embedding" ? (embedding?.modelId ?? null) : "m"), embedding });
  const usageRows = () => db.select().from(schema.llmUsage);
  const cfgRow = async () => (await db.select().from(schema.providerConfigs).where(eq(schema.providerConfigs.id, cfgId)))[0];
  const opts = { role: "fast" as const, purpose: "test.extract", schema: Person, instructions: "Extract the person.", prompt: "Ada, 3 years" };
  const apiError = (statusCode: number) => new APICallError({ message: "denied", url: "https://api", requestBodyValues: {}, statusCode, isRetryable: false });

  beforeEach(async () => {
    await resetDb(db);
    await seedUser(db, "u1");
    cfgId = await insertConfig(db, config, { userId: "u1", kind: "openai_compatible", baseUrl: "http://127.0.0.1:8080/v1" });
  });

  describe("generateStructured", () => {
    it("uses native structured output when supported, and records usage", async () => {
      const model = scripted(reply('{"name":"Ada","years":3}'));
      expect(await generateStructured(deps, llmFor(model, true), opts)).toEqual({ name: "Ada", years: 3 });
      expect(model.doGenerateCalls[0]?.responseFormat).toMatchObject({ type: "json", schema: { type: "object" } });
      expect(await usageRows()).toEqual([expect.objectContaining({ userId: "u1", providerConfigId: cfgId, model: "m",
        role: "fast", purpose: "test.extract", inputTokens: 10, outputTokens: 20 })]);
    });
    it("falls back to prompted JSON with the schema in the instructions", async () => {
      const model = scripted(reply('```json\n{"name":"Ada","years":3}\n```'));
      expect(await generateStructured(deps, llmFor(model, false), opts)).toEqual({ name: "Ada", years: 3 });
      expect(model.doGenerateCalls[0]?.responseFormat?.type ?? "text").toBe("text");
      expect(JSON.stringify(model.doGenerateCalls[0]?.prompt[0])).toContain("integer");
    });
    it("repairs once with the validation errors (Review Focus 4)", async () => {
      const model = scripted(reply('{"name":"Ada","years":"three"}'), reply('{"name":"Ada","years":3}'));
      expect(await generateStructured(deps, llmFor(model, false), opts)).toEqual({ name: "Ada", years: 3 });
      expect(model.doGenerateCalls).toHaveLength(2);
      expect(JSON.stringify(model.doGenerateCalls[1]?.prompt.at(-1))).toContain("years");
      expect(await usageRows()).toHaveLength(2);
    });
    it("gives up after exactly one repair, on both paths (Review Focus 4)", async () => {
      for (const jsonSchema of [false, true]) {
        const model = scripted(reply("not json"), reply('{"name":1}'), reply('{"name":"Ada","years":3}'));
        const err = await generateStructured(deps, llmFor(model, jsonSchema), opts).catch((e) => e);
        expect(err).toBeInstanceOf(StructuredOutputError);
        expect((err as StructuredOutputError).issues.length).toBeGreaterThan(0);
        expect(model.doGenerateCalls).toHaveLength(2);
      }
    });
    it("marks the config on 401 and rethrows, but not on 429 (Review Focus 3)", async () => {
      const limited = apiError(429);
      await expect(generateStructured(deps, llmFor(scripted(limited), true), opts)).rejects.toBe(limited);
      expect((await cfgRow())?.authFailed).toBe(false);
      const denied = apiError(401);
      await expect(generateStructured(deps, llmFor(scripted(denied), true), opts)).rejects.toBe(denied);
      expect(await cfgRow()).toMatchObject({ status: "degraded", authFailed: true });
    });
  });

  describe("generateTextFor and embedTexts", () => {
    it("returns text and estimates usage when the provider reports none", async () => {
      const model = scripted(reply("Hello there", undefined, undefined));
      expect(await generateTextFor(deps, llmFor(model, true), { role: "main", purpose: "test.text", instructions: "Hi", prompt: "abcdefgh" })).toBe("Hello there");
      const [row] = await usageRows();
      expect(row).toMatchObject({ role: "main", purpose: "test.text", outputTokens: 3 });
      expect(row?.inputTokens).toBeGreaterThan(0);
    });
    it("returns null without an embedding model, else vectors with embedding usage", async () => {
      expect(await embedTexts(deps, llmFor(scripted(), true), "test.embed", ["a"])).toBeNull();
      const model = new MockEmbeddingModelV4({ doEmbed: async ({ values }) => ({ embeddings: values.map(() => [1, 0]), usage: { tokens: 7 }, warnings: [] }) });
      const llm = llmFor(scripted(), true, { model, modelId: "emb", providerConfigId: cfgId });
      expect(await embedTexts(deps, llm, "test.embed", ["a", "b"])).toEqual([[1, 0], [1, 0]]);
      expect(await usageRows()).toEqual([expect.objectContaining({ role: "embedding", model: "emb", inputTokens: 7, outputTokens: 0 })]);
    });
  });
  ```

- [ ] **Step 2: Run tests to verify they fail**

  Run: `pnpm test packages/core/src/llm/generate.test.ts && pnpm test:int packages/core/src/llm/generate`
  Expected: FAIL. `./generate` / `./auth` not found.

- [ ] **Step 3: Implement**

  - **`parseJsonReply`:**
    1. Trim. If the text is a fenced block (` ```json ` or ` ``` `), take its body. Else, if it doesn't start with `{` or `[`, take the substring from the first `{` to the last `}`.
    2. A `JSON.parse` failure → `["Reply is not valid JSON: <message>"]`. Zod issues → `"<path joined by '.' or '(root)'>: <message>"`.
  - **`generateStructured`:**
    - **Native** (`capabilities.jsonSchema`): `generateText({ model, instructions, prompt | messages, output: Output.object({ schema }) })`. Wrap both the call and the `result.output` read. A `NoObjectGeneratedError` / `NoOutputGeneratedError` is a failed attempt; its issues come from `parseJsonReply(err.text ?? "", schema)`, or `[err.message]` when that parses.
    - **Prompted:** plain `generateText` with these instructions, then `parseJsonReply`:
      ```
      ${instructions}

      Respond with only a JSON object that matches this JSON Schema. Do not add prose or code fences.
      <json-schema>
      ${JSON.stringify(z.toJSONSchema(schema), null, 2)}
      </json-schema>
      ```
    - **Repair:** on the first failure, repeat once on the same path with the original messages (or `[{ role: "user", content: prompt }]`) plus `{ role: "assistant", content: <previous raw text> }` and `{ role: "user", content: "Your previous reply did not match the required JSON.\nProblems:\n- <issue>…\nReply with only the corrected JSON object." }`. A second failure throws `StructuredOutputError("Structured output invalid after one repair", issues)`.
    - Record usage for every completed attempt, failed ones included. If the call throws and `isAuthError(e)`, `await markAuthFailed(db, llm.providerConfigId)`, then rethrow the original error unchanged.
  - **`generateTextFor`:** the same call, usage, and auth handling, returning `result.text`.
  - **`embedTexts`:** `embedMany` on `llm.embedding.model`; one usage row with role `embedding`, `providerConfigId = llm.embedding.providerConfigId`, `inputTokens = usage.tokens`, `outputTokens = 0`. Auth handling marks the embedding config.
  - **Usage numbers:** `inputTokens ?? estimateTokens(instructions + prompt/messages text)`, `outputTokens ?? estimateTokens(output text)`.
  - **`isAuthError`:** `APICallError.isInstance(e)` with status 401 or 403, also checked on `RetryError.lastError`.
  - **`markAuthFailed`:** sets `status = 'degraded'`, `auth_failed = true`, `updated_at = now()`.
  - Leave AI SDK transport retries at their default. Failure logs carry `{ purpose, role, providerConfigId, attempt }`, never prompt or reply text unless `config.logContent`.

- [ ] **Step 4: Run tests**

  Run: `pnpm test packages/core/src/llm && pnpm test:int packages/core/src/llm`
  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add -A
  git commit -m "feat: add structured-output fallback, usage tracking, and auth-failure marking"
  ```

---

### Task 6: Capability probe

**Files:**
- Create: `packages/core/src/llm/probe.ts`, `packages/core/src/llm/mock/fixtures/probe.ts`
- Modify: `packages/core/src/llm/mock/fixtures/index.ts`, `packages/core/src/llm/index.ts`
- Test: `packages/core/src/llm/probe.int.test.ts`

The probe fixture lives here rather than in Task 4 because it mirrors the probe's prompts.

**Interfaces:**
- Consumes: `createLanguageModel`, `contextWindowFor`, `staticPdfInput` (Task 3); `recordUsage`, `isAuthError` (Task 5); `registerMockFixture` (Task 4).
- Produces (`@pathwise/core/llm`):
  ```ts
  export interface ProbeTarget extends ProviderTarget { userId: string }   // whose usage the probe records
  export interface ProbeResult { capabilities: Capabilities; status: ProviderStatus; checks: ProbeChecks }
  export function probeCapabilities(deps: LlmDeps, target: ProbeTarget, opts?: { model?: (role: "main" | "fast") => LanguageModel }): Promise<ProbeResult>;
  export function statusFromChecks(checks: ProbeChecks): ProviderStatus;
  export const probeFixture: (call: MockCall) => MockReply;               // registered for purpose "probe"
  ```

- [ ] **Step 1: Write the failing tests**

  ```ts
  // packages/core/src/llm/probe.int.test.ts
  import { APICallError, simulateReadableStream } from "ai";
  import { MockLanguageModelV4, mockValues } from "ai/test";
  import { beforeEach, describe, expect, it } from "vitest";
  import { getTestDb, resetDb } from "../../../../test/integration/db";
  import { insertConfig, seedUser, testConfig } from "../../../../test/integration/fixtures";
  import { schema } from "../db";
  import { type ProbeTarget, probeCapabilities } from "./probe";

  const db = getTestDb();
  const deps = { db, config: testConfig() };
  const usage = { inputTokens: { total: 5, noCache: 5, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 5, text: 5, reasoning: undefined } };
  const done = (unified: "stop" | "tool-calls") => ({ finishReason: { unified, raw: undefined }, usage, warnings: [] });
  const text = (t: string) => ({ content: [{ type: "text" as const, text: t }], ...done("stop") });
  const toolCall = (toolName: string, input: unknown) => ({ content: [{ type: "tool-call" as const, toolCallId: "c1", toolName, input: JSON.stringify(input) }], ...done("tool-calls") });
  const stream = (...deltas: string[]) => ({ stream: simulateReadableStream({ chunks: [
    { type: "text-start" as const, id: "t" }, ...deltas.map((delta) => ({ type: "text-delta" as const, id: "t", delta })),
    { type: "text-end" as const, id: "t" }, { type: "finish" as const, finishReason: { unified: "stop" as const, raw: undefined }, usage }] }) });
  // Pinned call order per model: basic (generate), streaming (stream), tools (generate), jsonSchema (generate).
  function model(gen: unknown[], str = () => stream("1 2 ", "3 4 5")) {
    const next = mockValues(...gen);
    return new MockLanguageModelV4({ modelId: "m", doStream: async () => str(),
      doGenerate: async () => { const r = next(); if (r instanceof Error) throw r; return r as never; } });
  }
  const GOOD = () => [text("ready"), toolCall("echo", { value: "pathwise" }), text('{"city":"Paris","population":2100000}')];
  let target: ProbeTarget;

  beforeEach(async () => {
    await resetDb(db);
    await seedUser(db, "u1");
    const id = await insertConfig(db, deps.config, { userId: "u1", kind: "openai_compatible", baseUrl: "http://127.0.0.1:8080/v1", status: "untested" });
    target = { id, userId: "u1", kind: "openai_compatible", baseUrl: "http://127.0.0.1:8080/v1", apiKey: null,
      models: { main: "m", fast: "m" }, contextWindow: null, capabilities: null };
  });

  describe("probeCapabilities", () => {
    it("reports full support when every check passes, and records usage under purpose probe", async () => {
      const r = await probeCapabilities(deps, target, { model: () => model(GOOD()) });
      expect(r.status).toBe("full");
      expect(r.checks).toEqual({ basic: { ok: true }, streaming: { ok: true }, tools: { ok: true }, jsonSchema: { ok: true } });
      expect(r.capabilities).toEqual({ basic: true, streaming: true, tools: true, jsonSchema: true, pdfInput: false, contextWindow: 8192 });
      const rows = await db.select().from(schema.llmUsage);
      expect(rows.map((u) => u.purpose)).toEqual(["probe", "probe", "probe", "probe"]);
    });
    it("is degraded when the model answers in text instead of calling the tool", async () => {
      const r = await probeCapabilities(deps, target, { model: () => model([text("ready"), text("I would call echo."), text('{"city":"Paris","population":1}')]) });
      expect(r.status).toBe("degraded");
      expect(r.checks.tools).toEqual({ ok: false, error: "The model replied without calling the tool." });
    });
    it("is degraded when structured output is not schema-valid", async () => {
      const r = await probeCapabilities(deps, target, { model: () => model([text("ready"), toolCall("echo", { value: "pathwise" }), text("About two million.")]) });
      expect(r.status).toBe("degraded");
      expect(r.checks.jsonSchema.error).toMatch(/did not match the schema/);
    });
    it("is unsupported when streaming yields a single chunk", async () => {
      const r = await probeCapabilities(deps, target, { model: () => model(GOOD(), () => stream("1 2 3 4 5")) });
      expect(r.status).toBe("unsupported");
      expect(r.checks.streaming.ok).toBe(false);
    });
    it("explains a rejected key and skips the remaining checks", async () => {
      const denied = new APICallError({ message: "invalid key", url: "https://x", requestBodyValues: {}, statusCode: 401 });
      const r = await probeCapabilities(deps, target, { model: () => model([denied]) });
      expect(r.status).toBe("unsupported");
      expect(r.checks.basic).toEqual({ ok: false, error: "The provider rejected the API key (HTTP 401)." });
      expect(r.checks.tools).toEqual({ ok: false, error: "Skipped because the basic check failed." });
    });
    it("also checks the fast model when it differs", async () => {
      const r = await probeCapabilities(deps, { ...target, models: { main: "m", fast: "m-fast" } },
        { model: (role) => (role === "fast" ? model([new Error("model m-fast not found")]) : model(GOOD())) });
      expect(r.status).toBe("unsupported");
      expect(r.checks.basic.error).toMatch(/^Fast model: model m-fast not found/);
    });
    it("passes with full support in LLM_MODE=mock via the probe fixture", async () => {
      const r = await probeCapabilities({ db, config: testConfig({ llmMode: "mock" }) }, { ...target, kind: "openai", baseUrl: null, apiKey: "sk-fake" });
      expect(r.status).toBe("full");
      expect(r.capabilities.contextWindow).toBe(128_000);
    });
  });
  ```

- [ ] **Step 2: Run tests to verify they fail**

  Run: `pnpm test:int packages/core/src/llm/probe`
  Expected: FAIL. `./probe` not found.

- [ ] **Step 3: Implement**

  - **Models:** build one model per role and reuse it for every check of that role: `opts.model?.(role)`, else `createLanguageModel(deps.config, target, role, "probe", { structuredOutputs: true })`. `structuredOutputs: true` makes `openai_compatible` send a real JSON-schema `response_format`, so the check measures native support. At runtime the factory uses `capabilities.jsonSchema` instead.
  - **Every call:** `maxRetries: 0`, `abortSignal: AbortSignal.timeout(60_000)`, `instructions: "You are a connectivity test. Follow the instruction exactly."`. Record usage (`role` main or fast, `purpose: "probe"`, `userId: target.userId`) for each call that returns.
  - **Checks, in this order:**
    1. `basic`: `generateText` with prompt `"Reply with the single word: ready"`. Passes if `text.trim()` is non-empty.
    2. `streaming`: `streamText` with prompt `"Count from 1 to 5, separated by spaces."`. Passes if `textStream` yields more than one non-empty chunk.
    3. `tools`: `generateText` with prompt `'Call the echo tool with value "pathwise". Do not reply with text.'`, tools `{ echo: tool({ description: "Echoes a value back.", inputSchema: z.object({ value: z.string() }) }) }` (no `execute`), and `toolChoice: "auto"`. Passes if some tool call has `toolName === "echo"` and `input.value === "pathwise"`; else the error is `"The model replied without calling the tool."`.
    4. `jsonSchema`: `generateText` with `output: Output.object({ schema: z.object({ city: z.string(), population: z.number().int() }) })` and prompt `"Return JSON for the city Paris with its approximate population."`. Errors become `"Structured output did not match the schema: <message>"`.
    5. When `models.fast !== models.main`: the `basic` prompt against the fast model. A failure sets `basic` to `{ ok: false, error: "Fast model: <message>" }`.
    - If check 1 fails, checks 2–5 are not run and get `{ ok: false, error: "Skipped because the basic check failed." }`.
  - **Error text (≤ 200 chars, never the key):** auth error → `"The provider rejected the API key (HTTP <status>)."`; timeout → `"Timed out after 60 seconds."`; other `APICallError` → `"HTTP <status>: <message>"`; else `e.message`.
  - **Result:** `statusFromChecks` applies the Global Constraints rule. `capabilities` = the four check results + `pdfInput: staticPdfInput(kind)` + `contextWindow: contextWindowFor(kind, models.main, contextWindow)`.
  - **`probeFixture`:** `toolNames` includes `"echo"` → `{ toolCalls: [{ toolName: "echo", input: { value: "pathwise" } }] }`; `lastUserText` contains `"city Paris"` → `{ json: { city: "Paris", population: 2100000 } }`; else `{ text: "ready 1 2 3 4 5" }`. `fixtures/probe.ts` calls `registerMockFixture("probe", probeFixture)`.

- [ ] **Step 4: Run tests**

  Run: `pnpm test packages/core/src/llm && pnpm test:int packages/core/src/llm`
  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add -A
  git commit -m "feat: add capability probe with status classification"
  ```

---

### Task 7: Custom-endpoint policy and providers service

**Files:**
- Create: `packages/core/src/services/providers/{endpoint-policy.ts,service.ts,index.ts}`
- Test: `packages/core/src/services/providers/endpoint-policy.test.ts`, `packages/core/src/services/providers/service.int.test.ts`

**Interfaces:**
- Consumes: `encryptSecret`, `decryptSecret`, `loadKeyring` (Task 1); `getUserSettings` (Task 2); `probeCapabilities`, `ProbeTarget` (Task 6); `markAuthFailed` (Task 5); `assertAdmin` (Plan 1); `ValidationError`, `ForbiddenError`, `NotFoundError`.
- Produces (`@pathwise/core/services/providers`): `ProviderConfigInput`, `ProviderConfigView`, `saveProviderConfig`, `testProviderConfig`, `listProviderConfigs`, `activateProviderConfig`, `deleteProviderConfig`, `getInstanceProviderConfig`, `setInstanceProviderConfig`, `getProviderStatusForUser` exactly as contract §4, with `actor: { userId: string; role: "admin" | "user" }` and `checks: ProbeChecks`. Plus:
  ```ts
  export type LookupFn = (host: string) => Promise<string[]>;      // default: dns.lookup(host, { all: true, verbatim: true })
  export function isPrivateAddress(ip: string): boolean;
  export function checkCustomEndpoint(config: Pick<AppConfig, "customEndpoints" | "allowPrivateEndpoints">, role: "admin" | "user", baseUrl: string, lookup?: LookupFn): Promise<void>;
  ```

- [ ] **Step 1: Write the failing tests**

  ```ts
  // packages/core/src/services/providers/endpoint-policy.test.ts
  import { describe, expect, it } from "vitest";
  import type { CustomEndpointsMode } from "../../config";
  import { ForbiddenError, ValidationError } from "../../errors";
  import { checkCustomEndpoint, isPrivateAddress, type LookupFn } from "./endpoint-policy";

  const cfg = (customEndpoints: CustomEndpointsMode, allowPrivateEndpoints = false) => ({ customEndpoints, allowPrivateEndpoints });
  const records: Record<string, string[]> = { "mixed.example": ["93.184.215.14", "127.0.0.1"], "meta.example": ["169.254.169.254"],
    "public.example": ["93.184.215.14"], "v6.example": ["fd00::5"] };
  const lookup: LookupFn = async (h) => records[h] ?? [];

  describe("isPrivateAddress", () => {
    it.each(["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.20", "169.254.169.254", "100.64.0.1",
      "0.0.0.0", "::1", "::", "fe80::1", "fd12:3456::1", "fc00::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:a9fe:a9fe"])(
      "%s is private", (ip) => expect(isPrivateAddress(ip)).toBe(true));
    it.each(["93.184.215.14", "172.32.0.1", "8.8.8.8", "2606:4700::1111", "::ffff:8.8.8.8"])(
      "%s is public", (ip) => expect(isPrivateAddress(ip)).toBe(false));
  });

  describe("checkCustomEndpoint", () => {
    it("off: nobody, not even admins; admin_only: admins only, private addresses allowed", async () => {
      await expect(checkCustomEndpoint(cfg("off"), "admin", "http://public.example/v1", lookup))
        .rejects.toThrow(new ForbiddenError("Custom endpoints are disabled on this instance."));
      await expect(checkCustomEndpoint(cfg("admin_only"), "user", "http://public.example/v1", lookup))
        .rejects.toThrow(new ForbiddenError("Only admins can add custom endpoints on this instance."));
      await expect(checkCustomEndpoint(cfg("admin_only"), "admin", "http://127.0.0.1:8080/v1", lookup)).resolves.toBeUndefined();
    });
    it("all: non-admins cannot reach hosts that resolve privately (Review Focus 2)", async () => {
      for (const url of ["http://mixed.example/v1", "http://meta.example/latest", "http://v6.example/v1",
        "http://[::ffff:127.0.0.1]:8080/v1", "http://127.0.0.1:8080/v1"]) {
        await expect(checkCustomEndpoint(cfg("all"), "user", url, lookup)).rejects.toThrow(/private or local network address/);
      }
      await expect(checkCustomEndpoint(cfg("all"), "user", "https://public.example/v1", lookup)).resolves.toBeUndefined();
      await expect(checkCustomEndpoint(cfg("all", true), "user", "http://meta.example/v1", lookup)).resolves.toBeUndefined();
    });
    it("rejects non-http URLs and unresolvable hosts", async () => {
      await expect(checkCustomEndpoint(cfg("all"), "user", "ftp://public.example", lookup)).rejects.toBeInstanceOf(ValidationError);
      await expect(checkCustomEndpoint(cfg("all"), "user", "not a url", lookup)).rejects.toBeInstanceOf(ValidationError);
      await expect(checkCustomEndpoint(cfg("all"), "user", "http://nowhere.example", lookup)).rejects.toThrow(/Could not resolve nowhere\.example/);
    });
  });
  ```

  ```ts
  // packages/core/src/services/providers/service.int.test.ts
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
  import { activateProviderConfig, deleteProviderConfig, getInstanceProviderConfig, getProviderStatusForUser,
    listProviderConfigs, saveProviderConfig, setInstanceProviderConfig, testProviderConfig } from ".";

  const db = getTestDb();
  const mock = testConfig({ llmMode: "mock" });
  const deps = { db, config: mock };
  const withConfig = (o: Parameters<typeof testConfig>[0]) => ({ db, config: testConfig({ llmMode: "mock", ...o }) });
  const user = { userId: "u1", role: "user" as const };
  const admin = { userId: "adm", role: "admin" as const };
  const anthropic = { kind: "anthropic" as const, label: "Mine", apiKey: "sk-ant-test-abcd", models: { main: "claude-sonnet-5-5", fast: "claude-haiku-5-5" } };
  const local = { kind: "openai_compatible" as const, label: "Local", baseUrl: "http://127.0.0.1:8080/v1", apiKey: "local-key-9999", models: { main: "qwen", fast: "qwen" } };
  const row = async (id: string) => (await db.select().from(schema.providerConfigs).where(eq(schema.providerConfigs.id, id)))[0];
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
      expect(v).toMatchObject({ scope: "user", kind: "anthropic", keyLast4: "abcd", status: "untested", authFailed: false });
      expect(JSON.stringify([v, await listProviderConfigs(db, "u1")])).not.toMatch(/sk-ant-test|v1:/);
      expect(decryptSecret(loadKeyring(mock), (await row(v.id))?.encryptedKey ?? "", v.id)).toBe("sk-ant-test-abcd");
    });
    it("rejects invalid input", async () => {
      for (const bad of [
        { ...anthropic, apiKey: undefined },                               // key required for known providers
        { ...anthropic, baseUrl: "https://proxy.example/v1" },              // base URL only for custom endpoints
        { ...anthropic, models: { ...anthropic.models, embedding: "e" } }, // Anthropic has no embedding models
        { ...anthropic, label: "" },
        { ...anthropic, models: { main: "", fast: "x" } },
        { ...anthropic, contextWindow: 50_000 },                           // only for custom endpoints
      ]) await expect(saveProviderConfig(deps, user, { ...bad, scope: "user" })).rejects.toBeInstanceOf(ValidationError);
      await expect(saveProviderConfig(deps, user, { ...anthropic, scope: "instance" })).rejects.toBeInstanceOf(ForbiddenError);
    });
    it("keeps the key when saved without one; only model or endpoint changes reset the status (Review Focus 5)", async () => {
      const v = await saveProviderConfig(deps, user, { ...anthropic, scope: "user" });
      await testProviderConfig(deps, user, v.id);
      const base = { ...anthropic, apiKey: undefined, id: v.id, scope: "user" as const };
      expect(await saveProviderConfig(deps, user, { ...base, label: "Renamed" })).toMatchObject({ label: "Renamed", status: "full", keyLast4: "abcd" });
      expect(await saveProviderConfig(deps, user, { ...base, models: { main: "claude-opus-5-5", fast: "claude-haiku-5-5" } }))
        .toMatchObject({ status: "untested", capabilities: null, keyLast4: "abcd" });
    });
    it("drops the stored key when the endpoint or kind changes (Review Focus 5)", async () => {
      const v = await saveProviderConfig(deps, admin, { ...local, scope: "user" });
      expect(await saveProviderConfig(deps, admin, { ...local, apiKey: undefined, baseUrl: "http://127.0.0.1:9090/v1", id: v.id, scope: "user" }))
        .toMatchObject({ keyLast4: null, status: "untested" });
      expect((await row(v.id))?.encryptedKey).toBeNull();
      const a = await saveProviderConfig(deps, user, { ...anthropic, scope: "user" });
      await expect(saveProviderConfig(deps, user, { ...anthropic, kind: "openai", apiKey: undefined, id: a.id, scope: "user" }))
        .rejects.toThrow(new ValidationError("Enter an API key."));
    });
  });

  describe("custom endpoints", () => {
    it("enforces CUSTOM_ENDPOINTS and the private-address rule (Review Focus 2)", async () => {
      await expect(saveProviderConfig(deps, user, { ...local, scope: "user" })).rejects.toBeInstanceOf(ForbiddenError); // admin_only
      const all = withConfig({ customEndpoints: "all" });
      for (const baseUrl of ["http://127.0.0.1:8080/v1", "http://169.254.169.254/v1", "http://[::ffff:127.0.0.1]:8080/v1"]) {
        await expect(saveProviderConfig(all, user, { ...local, baseUrl, scope: "user" })).rejects.toBeInstanceOf(ForbiddenError);
      }
      await expect(saveProviderConfig(all, user, { ...local, baseUrl: "http://93.184.215.14/v1", scope: "user" })).resolves.toMatchObject({ kind: "openai_compatible" });
    });
    it("re-checks the policy at test time (Review Focus 2)", async () => {
      const v = await saveProviderConfig(withConfig({ customEndpoints: "all", allowPrivateEndpoints: true }), user, { ...local, scope: "user" });
      await expect(testProviderConfig(withConfig({ customEndpoints: "all" }), user, v.id)).rejects.toBeInstanceOf(ForbiddenError);
      expect((await row(v.id))?.status).toBe("untested");
    });
  });

  describe("testing, activation, deletion", () => {
    it("refuses activation until a test passes", async () => {
      const v = await saveProviderConfig(deps, user, { ...anthropic, scope: "user" });
      await expect(activateProviderConfig(db, "u1", v.id)).rejects.toThrow(new ValidationError("Run a successful capability test before activating this provider."));
      expect(await testProviderConfig(deps, user, v.id)).toMatchObject({ status: "full", checks: { basic: { ok: true } }, lastTestedAt: expect.any(Date) });
      await activateProviderConfig(db, "u1", v.id);
      expect((await getUserSettings(db, "u1")).providerConfigId).toBe(v.id);
      expect(await getProviderStatusForUser(db, "u1")).toEqual({ source: "user", authFailed: false, status: "full" });
    });
    it("scopes every operation to the owner", async () => {
      const v = await saveProviderConfig(deps, user, { ...anthropic, scope: "user" });
      const other = { userId: "u2", role: "user" as const };
      await expect(testProviderConfig(deps, other, v.id)).rejects.toBeInstanceOf(NotFoundError);
      await expect(activateProviderConfig(db, "u2", v.id)).rejects.toBeInstanceOf(NotFoundError);
      await expect(deleteProviderConfig(db, "u2", v.id)).rejects.toBeInstanceOf(NotFoundError);
      await expect(saveProviderConfig(deps, other, { ...anthropic, id: v.id, scope: "user" })).rejects.toBeInstanceOf(NotFoundError);
      expect(await listProviderConfigs(db, "u2")).toEqual([]);
    });
    it("a passing re-test clears a rejected key; a failing one deactivates (Review Focus 3)", async () => {
      const v = await savedAndActive();
      await markAuthFailed(db, v.id);
      expect(await getProviderStatusForUser(db, "u1")).toEqual({ source: "user", authFailed: true, status: "degraded" });
      expect(await testProviderConfig(deps, user, v.id)).toMatchObject({ status: "full", authFailed: false });
      registerMockFixture("probe", () => { throw new Error("boom"); });
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
      expect(await getProviderStatusForUser(db, "u1")).toEqual({ source: "none", authFailed: false, status: null });
      await expect(setInstanceProviderConfig(deps, "u1", anthropic)).rejects.toBeInstanceOf(ForbiddenError);
      const a = await setInstanceProviderConfig(deps, "adm", anthropic);
      const b = await setInstanceProviderConfig(deps, "adm", { ...anthropic, apiKey: undefined, label: "Team" });
      expect(b).toMatchObject({ id: a.id, scope: "instance", label: "Team", keyLast4: "abcd" });
      expect((await getInstanceProviderConfig(db, "adm"))?.label).toBe("Team");
      await expect(getInstanceProviderConfig(db, "u1")).rejects.toBeInstanceOf(ForbiddenError);
      await expect(testProviderConfig(deps, user, a.id)).rejects.toBeInstanceOf(ForbiddenError);
      expect(await listProviderConfigs(db, "adm")).toEqual([]);
      await testProviderConfig(deps, admin, a.id);
      expect(await getProviderStatusForUser(db, "u1")).toEqual({ source: "instance", authFailed: false, status: "full" });
    });
  });
  ```

- [ ] **Step 2: Run tests to verify they fail**

  Run: `pnpm test packages/core/src/services/providers && pnpm test:int packages/core/src/services/providers`
  Expected: FAIL. Modules not found.

- [ ] **Step 3: Implement the endpoint policy**

  - **`isPrivateAddress`:** first normalize IPv4-mapped IPv6 (`::ffff:a.b.c.d` and `::ffff:XXXX:YYYY`) to IPv4. Then test against a `net.BlockList` holding:
    - IPv4: `0.0.0.0/8`, `10.0.0.0/8`, `100.64.0.0/10`, `127.0.0.0/8`, `169.254.0.0/16`, `172.16.0.0/12`, `192.168.0.0/16`
    - IPv6: `::/128`, `::1/128`, `fe80::/10`, `fc00::/7`
  - **`checkCustomEndpoint`**, in order:
    1. Mode `off` → `ForbiddenError` "disabled". Mode `admin_only` with role `user` → `ForbiddenError` "Only admins…" (copy as in the test).
    2. A URL that won't parse or isn't `http(s)` → `ValidationError("Base URL must be an http(s) URL.")`.
    3. Admins, or `allowPrivateEndpoints` → done.
    4. Strip `[` `]` from the hostname. IP literals (`net.isIP`) are checked directly; other hosts → `await lookup(host)`. An empty list → `ValidationError("Could not resolve <host>.")`.
    5. Any private address → `ForbiddenError("This endpoint resolves to a private or local network address (<ip>), which is not allowed. Ask your admin to set ALLOW_PRIVATE_ENDPOINTS=true if this is intended.")`.

- [ ] **Step 4: Implement the service**

  - **Validation** (`ValidationError`, user-facing copy):
    - label 1–60 chars; `models.main`/`models.fast` 1–200 chars; `contextWindow` only for `openai_compatible`, integer 1,024–10,000,000
    - `baseUrl` required for `openai_compatible` and otherwise rejected ("A base URL is only used for OpenAI-compatible endpoints.")
    - after the key-carry rule, a key is required for `anthropic`/`openai`/`google` ("Enter an API key.")
    - `models.embedding` on `anthropic` requires `embeddingProviderConfigId` ("Anthropic has no embedding models. Choose another provider for embeddings.")
    - `embeddingProviderConfigId` must name a same-owner, non-Anthropic config
  - **Ownership:** a user-scope config is visible only to its `user_id`, else `NotFoundError("Provider not found")`. Instance-scope configs (`user_id is null`) require `assertAdmin` for save and test.
  - **`saveProviderConfig`:**
    1. `scope: "instance"` → `assertAdmin`.
    2. `openai_compatible` → `await checkCustomEndpoint(config, actor.role, baseUrl)`.
    3. On update, carry the old key when `apiKey` is undefined and `kind`/`baseUrl` are unchanged. Reset status per Spec gap 2.
    4. Insert with a pre-generated `randomUUID()` so the AAD is known. Store `encryptSecret(loadKeyring(config), apiKey, id)` and `key_last4 = apiKey.slice(-4)`. An empty key on `openai_compatible` stores no key.
  - **`testProviderConfig`:**
    1. Load, check ownership, re-run `checkCustomEndpoint`.
    2. Decrypt. Failure → `ValidationError("The stored key can't be decrypted (the encryption key changed). Enter the API key again.")`.
    3. `probeCapabilities(deps, { …target, userId: actor.userId })`.
    4. Write `capabilities`, `status`, `auth_failed = false`, `last_tested_at = now()`.
    5. On `unsupported`, null out `user_settings.provider_config_id` wherever it equals this id.
    6. Return the view plus `checks`.
  - **`activateProviderConfig`:** own configs only (instance ids give `NotFoundError`). The status must be `full`/`degraded` and `auth_failed` false, else the `ValidationError` in the test. Upsert `user_settings.provider_config_id`.
  - **`setInstanceProviderConfig`:** `assertAdmin`; `saveProviderConfig(deps, { userId: actorId, role: "admin" }, { ...input, id: currentInstanceId ?? undefined, scope: "instance" })`; set `instance_settings.instance_provider_config_id`.
  - **`getProviderStatusForUser`:** the same resolution order as `resolveLlm` (Task 3), without decrypting.
  - **Views:** never include `encrypted_key`. `listProviderConfigs` returns the user's own configs, oldest first.

- [ ] **Step 5: Run tests**

  Run: `pnpm test && pnpm test:int && pnpm typecheck`
  Expected: PASS.

- [ ] **Step 6: Commit**

  ```bash
  git add -A
  git commit -m "feat: add providers service with custom-endpoint policy"
  ```

---

### Task 8: Encryption key rotation CLI

**Files:**
- Create: `packages/core/src/crypto/rotate.ts` (re-export from `crypto/index.ts`)
- Modify: `apps/worker/src/cli.ts`, `apps/worker/src/cli.test.ts`, `README.md` (under Configuration: "Back up the `pathwise-secrets` volume with the database. Rotate the encryption key with `docker compose exec worker pathwise admin rotate-encryption-key`.")
- Test: `packages/core/src/crypto/rotate.int.test.ts`, `apps/worker/src/cli.test.ts`

**Interfaces:**
- Consumes: `encryptSecret`, `decryptSecret`, `loadKeyring` (Task 1); `insertConfig` (Task 3); `ConfigError`.
- Produces: `rotateEncryptionKey(db, config, env): Promise<{ rotated: number }>` (contract §4); CLI `pathwise admin rotate-encryption-key`.

- [ ] **Step 1: Write the failing tests**

  ```ts
  // packages/core/src/crypto/rotate.int.test.ts
  import { randomBytes } from "node:crypto";
  import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
  import { tmpdir } from "node:os";
  import { join } from "node:path";
  import { eq } from "drizzle-orm";
  import { beforeEach, describe, expect, it } from "vitest";
  import { getTestDb, resetDb } from "../../../../test/integration/db";
  import { insertConfig, seedUser, testConfig } from "../../../../test/integration/fixtures";
  import { schema } from "../db";
  import { decryptSecret, encryptSecret, loadKeyring, rotateEncryptionKey } from ".";

  const db = getTestDb();
  let dir: string;
  let oldKey: Buffer;
  const file = (suffix = "") => join(dir, `APP_ENCRYPTION_KEY${suffix}`);
  const readKey = (suffix = "") => Buffer.from(readFileSync(file(suffix), "utf8").trim(), "base64");
  const cfg = () => testConfig({ secretsDir: dir, appEncryptionKey: readKey() }); // what a freshly started process loads
  const rows = () => db.select().from(schema.providerConfigs);
  const plaintexts = async (current: Buffer) =>
    (await rows()).map((r) => decryptSecret({ current, others: [] }, r.encryptedKey ?? "", r.id)).sort();
  const writeNext = () => { const next = randomBytes(32); writeFileSync(file(".next"), next.toString("base64"), { mode: 0o600 }); return next; };

  beforeEach(async () => {
    await resetDb(db);
    await seedUser(db, "u1");
    dir = mkdtempSync(join(tmpdir(), "pw-rotate-"));
    oldKey = randomBytes(32);
    writeFileSync(file(), oldKey.toString("base64"), { mode: 0o600 });
    await insertConfig(db, cfg(), { userId: "u1", apiKey: "key-one" });
    await insertConfig(db, cfg(), { userId: null, apiKey: "key-two" });
  });

  describe("rotateEncryptionKey", () => {
    it("re-encrypts every key and keeps the old key as .previous", async () => {
      expect(await rotateEncryptionKey(db, cfg(), {})).toEqual({ rotated: 2 });
      expect(readKey().equals(oldKey)).toBe(false);
      expect(readKey(".previous").equals(oldKey)).toBe(true);
      expect(existsSync(file(".next"))).toBe(false);
      expect(statSync(file()).mode & 0o777).toBe(0o600);
      expect(await plaintexts(readKey())).toEqual(["key-one", "key-two"]);
    });
    it("refuses when the key comes from the environment", async () => {
      await expect(rotateEncryptionKey(db, cfg(), { APP_ENCRYPTION_KEY: oldKey.toString("base64") })).rejects.toThrow(/environment/);
      expect(existsSync(file(".next"))).toBe(false);
    });
    it("finishes after a crash before the database commit (Review Focus 1)", async () => {
      const next = writeNext();
      expect(await rotateEncryptionKey(db, cfg(), {})).toEqual({ rotated: 2 });
      expect(readKey().equals(next)).toBe(true);
      expect(await plaintexts(next)).toEqual(["key-one", "key-two"]);
    });
    it("stays readable after a crash between commit and file swap, then finishes (Review Focus 1)", async () => {
      const next = writeNext();
      for (const r of await rows()) {
        const plain = decryptSecret({ current: oldKey, others: [] }, r.encryptedKey ?? "", r.id);
        await db.update(schema.providerConfigs).set({ encryptedKey: encryptSecret({ current: next, others: [] }, plain, r.id) })
          .where(eq(schema.providerConfigs.id, r.id));
      }
      const running = loadKeyring(cfg()); // a process still holding the old key
      for (const r of await rows()) expect(() => decryptSecret(running, r.encryptedKey ?? "", r.id)).not.toThrow();
      expect(await rotateEncryptionKey(db, cfg(), {})).toEqual({ rotated: 2 });
      expect(readKey().equals(next)).toBe(true);
      expect(await plaintexts(next)).toEqual(["key-one", "key-two"]);
    });
    it("aborts without changes when a stored key cannot be decrypted", async () => {
      await insertConfig(db, testConfig({ appEncryptionKey: randomBytes(32) }), { userId: "u1" });
      const before = await rows();
      await expect(rotateEncryptionKey(db, cfg(), {})).rejects.toThrow(/cannot be decrypted/);
      expect(await rows()).toEqual(before);
      expect(readKey().equals(oldKey)).toBe(true);
    });
  });
  ```

  In `apps/worker/src/cli.test.ts`, extend the usage test with `expect(out.join("\n")).toMatch(/admin rotate-encryption-key/)`.

- [ ] **Step 2: Run tests to verify they fail**

  Run: `pnpm test:int packages/core/src/crypto && pnpm test apps/worker`
  Expected: FAIL. `rotateEncryptionKey` not exported; usage lacks the command.

- [ ] **Step 3: Implement**

  `rotateEncryptionKey` (`P = ${secretsDir}/APP_ENCRYPTION_KEY`, `N = P.next`, `V = P.previous`):
  1. If `env.APP_ENCRYPTION_KEY` is non-empty, throw `ConfigError("APP_ENCRYPTION_KEY is set in the environment, so rotation can't replace it: the environment value always wins over the secrets volume. To rotate, move the value into <P> (mode 0600), remove the variable, restart, then run this command again.")`.
  2. The new key is `N`'s content when `N` exists (a previous run crashed); otherwise write `randomBytes(32)` to `N` (temp file + rename, mode 0600).
  3. In one transaction, `select … for update` every `provider_configs` row with `encrypted_key is not null`. Decrypt each with `{ current: config.appEncryptionKey, others: [newKey, ...loadKeyring(config).others] }`, so rows already under the new key also work. Re-encrypt with `{ current: newKey }` and the row id as AAD. A `SecretDecryptError` throws `ConfigError("Provider config <id> cannot be decrypted with any available key. Delete it or re-enter its key, then run this command again.")`, which rolls back.
  4. After commit, write the current key to `V` (temp + rename), then `rename(N, P)`. `P` exists at every instant. Between steps 3 and 4, running processes still decrypt because `loadKeyring` reads `N` (Task 1).
  5. Return `{ rotated: rows.length }`.

  CLI (`runCli`): `admin rotate-encryption-key` loads config, runs the function, prints `Re-encrypted <n> provider keys.` and `Restart web and worker to use the new key: docker compose restart web worker`, and returns 0. On `ConfigError` it prints the message and returns 1. Add `admin rotate-encryption-key      Re-encrypt stored API keys with a new key` to `USAGE`.

- [ ] **Step 4: Run tests and verify inside the stack**

  Run: `pnpm test:int packages/core/src/crypto && pnpm test apps/worker`
  Expected: PASS.

  Run: `docker compose --env-file /dev/null -p pathwise-smoke up -d --build --wait web worker && docker compose -p pathwise-smoke exec worker pathwise admin rotate-encryption-key; docker compose -p pathwise-smoke exec worker ls /var/lib/pathwise/secrets; docker compose -p pathwise-smoke down -v`
  Expected: `Re-encrypted 0 provider keys.` plus the restart line; the listing shows `APP_ENCRYPTION_KEY`, `APP_ENCRYPTION_KEY.previous`, `BETTER_AUTH_SECRET`.

- [ ] **Step 5: Commit**

  ```bash
  git add -A
  git commit -m "feat: add crash-safe encryption key rotation CLI"
  ```

---

### Task 9: Settings screen, provider banner, timezone sync

**Files:**
- Create: `apps/web/src/app/(app)/settings/{page.tsx,actions.ts,provider-list.tsx,coach-settings.tsx}`, `apps/web/src/components/{provider-form.tsx,probe-results.tsx,provider-banner.tsx,timezone-sync.tsx}`, `apps/web/src/app/(app)/actions.ts`, `e2e/settings.spec.ts`
- Modify: `apps/web/src/app/(app)/layout.tsx`, `apps/web/src/components/app-nav.tsx`, `scripts/e2e.sh` (add `LLM_MODE=mock` to the `export` line), `playwright.config.ts` (project `settings`, `testMatch: "settings.spec.ts"`, `dependencies: ["admin"]`)
- Test: `e2e/settings.spec.ts`

**Interfaces:**
- Consumes: the providers service (Task 7); `getUserSettings`, `updateUserSettings` (Task 2); `MODEL_SUGGESTIONS`, `ProbeChecks` (Tasks 3, 6); `requireSession`, `getServer` (Plan 1).
- Produces:
  - `ProviderForm` (client) with props `{ scope: "user" | "instance"; allowCustom: boolean; embeddingOptions?: { id: string; label: string }[]; initial?: ProviderConfigView; action }`, where `action: (prev: ProviderFormState, fd: FormData) => Promise<ProviderFormState>` and `ProviderFormState = { error?: string; result?: { label: string; status: ProviderStatus; checks: ProbeChecks } } | undefined`.
  - `ProbeResults`; `ProviderBanner` (server, props `{ status: Awaited<ReturnType<typeof getProviderStatusForUser>>; isAdmin: boolean }`); `TimezoneSync` (client, props `{ needsTimezone: boolean }`).
  - Server actions: `saveProviderAction`, `testProviderAction`, `activateProviderAction`, `deleteProviderAction`, `saveCoachSettingsAction` (settings), and `saveDetectedTimezoneAction(tz: string)` in `(app)/actions.ts`.

- [ ] **Step 1: Write the failing E2E test**

  ```ts
  // e2e/settings.spec.ts — runs after admin.spec.ts (project dependency) with LLM_MODE=mock
  import { expect, type Page, test } from "@playwright/test";

  test.describe.configure({ mode: "serial" });
  const KEY = "sk-test-0000000000001234";
  const CONNECT = "Connect an AI provider to use the coach";

  async function signInAsAda(page: Page) {
    await page.goto("/sign-in");
    await page.getByLabel("Email").fill("ada@example.com");
    await page.getByLabel("Password").fill("a-very-long-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("heading", { name: /^Welcome, / })).toBeVisible();
  }

  test("a user without a provider is prompted to connect one", async ({ page }) => {
    await signInAsAda(page);
    await expect(page.getByText(CONNECT)).toBeVisible();
    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
    await expect(page.getByText("Mock mode: AI replies are simulated (LLM_MODE=mock).")).toBeVisible();
  });

  test("add, test and activate an OpenAI provider (Review Focus 5)", async ({ page }) => {
    await signInAsAda(page);
    await page.goto("/settings");
    await page.getByLabel("Provider", { exact: true }).click();
    await page.getByRole("option", { name: "OpenAI", exact: true }).click();
    await page.getByLabel("Label", { exact: true }).fill("My OpenAI");
    await page.getByLabel("API key").fill(KEY);
    await page.getByLabel("Main model").fill("gpt-main");
    await page.getByLabel("Fast model").fill("gpt-fast");
    await page.getByRole("button", { name: "Save and test" }).click();
    await expect(page.getByText("Full support. All coach features are available.")).toBeVisible();
    await expect(page.getByText("Passed", { exact: true })).toHaveCount(4);
    const row = page.getByRole("row", { name: /My OpenAI/ });
    await expect(row.getByText("Full support", { exact: true })).toBeVisible();
    await expect(row.getByText("••••1234")).toBeVisible();
    await row.getByRole("button", { name: "Activate" }).click();
    await expect(row.getByText("Active", { exact: true })).toBeVisible();
    await expect(page.getByText(CONNECT)).toHaveCount(0);
    await page.reload();
    await expect(page.getByLabel("API key")).toHaveValue("");
    expect(await page.content()).not.toContain(KEY);
  });

  test("coach settings persist", async ({ page }) => {
    await signInAsAda(page);
    await page.goto("/settings");
    await page.getByLabel("Blunt", { exact: true }).check();
    await page.getByLabel("Timezone").selectOption("Europe/Berlin");
    await page.getByRole("button", { name: "Save coach settings" }).click();
    await expect(page.getByText("Saved.")).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Blunt", { exact: true })).toBeChecked();
    await expect(page.getByLabel("Timezone")).toHaveValue("Europe/Berlin");
  });
  ```

- [ ] **Step 2: Run to verify it fails**

  Run: `pnpm e2e e2e/settings.spec.ts`
  Expected: FAIL. No banner and no Settings link.

- [ ] **Step 3: Implement**

  - **Layout** (`(app)/layout.tsx`): load `getUserSettings` and `getProviderStatusForUser` for the session user, then render `AppNav`, `<ProviderBanner>`, `<TimezoneSync needsTimezone={settings.timezone === null} />`, and `main`. **Nav:** Today, Settings (`/settings`), Admin (admins only).
  - **`ProviderBanner`** (an `Alert`, first matching row wins):

    | Condition | Copy | Link |
    |---|---|---|
    | `authFailed` and `source === "user"` | "Your API key was rejected." | "Update it in Settings" → `/settings` |
    | `authFailed` and `source === "instance"` | "The instance's AI provider key was rejected. Ask your admin to update it." | admins only: "Open Admin" → `/admin` |
    | `source === "none"`, or status `untested`/`unsupported` | "Connect an AI provider to use the coach" | "Open Settings" → `/settings` |
    | otherwise | nothing | — |

  - **`TimezoneSync`:** when `needsTimezone`, a mount effect calls `saveDetectedTimezoneAction(Intl.DateTimeFormat().resolvedOptions().timeZone)` once and renders nothing. The action re-reads the settings and updates only while `timezone` is still `null`, ignoring `ValidationError`, so it never overwrites a chosen zone.
  - **Settings page** (`requireSession()`): heading `Settings`. When `config.llmMode === "mock"`, an `Alert` reads "Mock mode: AI replies are simulated (LLM_MODE=mock)."
    - **Card "AI provider"** (h2):
      - When `source === "instance"`: the note "You're using the instance provider set by your admin. Add your own below to use your own key."
      - **`ProviderList`:** a table with columns Label, Provider, Status, Key, and actions.
        - Provider names: Anthropic / OpenAI / Google / OpenAI-compatible endpoint.
        - Status badge: `full` "Full support", `degraded` "Limited support", `unsupported` "Not supported", `untested` "Not tested"; `authFailed` overrides with a destructive "Key rejected".
        - Key cell: `••••<last4>` or "No key". The active config gets an extra badge "Active".
        - Buttons: "Test", "Activate" (usable, non-active configs only), "Edit" (loads the form), "Delete".
        - Empty state: "No providers yet. Add one below." Test results render in `ProbeResults` above the table.
      - **`ProviderForm`:**
        - Heading "Add a provider" / "Edit provider".
        - "Provider": a `Select` with `name="kind"` and options Anthropic, OpenAI, Google, and "OpenAI-compatible endpoint". The last is shown only when `allowCustom`, which is `customEndpoints === "all"`, or `"admin_only"` and the user is an admin.
        - "Label".
        - "Base URL": custom kind only, placeholder `http://host.docker.internal:8080/v1`.
        - "API key": `type="password"`, always rendered empty. Placeholder on edit: "Leave blank to keep the current key"; for the custom kind: "Optional".
        - "Main model", "Fast model", "Embedding model (optional)".
        - "Embedding provider": user scope only, options "This provider" plus `embeddingOptions` (own non-Anthropic configs other than the one being edited).
        - "Context window (tokens)": custom kind only, placeholder `8192`.
        - Submit "Save and test". On edit, "Cancel".
        - When Provider changes and the model inputs are empty or still hold the previous kind's suggestion, fill them from `MODEL_SUGGESTIONS[kind]`.
    - **Card "Coach"** (h2):
      - A fieldset with legend "Bluntness" and radios labelled "Gentle" (1), "Soft" (2), "Balanced" (3), "Direct" (4), "Blunt" (5).
      - A native `<select>` labelled "Timezone": first option "Not set (UTC)" (empty value), then `Intl.supportedValuesOf("timeZone")`.
      - Button "Save coach settings". Success text "Saved.".
  - **`ProbeResults`:**
    - Heading "Test results for {label}".
    - Rows "Basic reply", "Streaming", "Tool calling", "Structured output (JSON schema)", each "Passed" or "Failed: {error}".
    - Summary line:
      - full: "Full support. All coach features are available."
      - degraded: "Limited support. The coach works, but without tool calling or native structured output it relies on fallbacks."
      - unsupported: "This provider can't be activated: it must pass the basic reply and streaming checks."
  - **Actions** (`"use server"`, `requireSession()`, then `revalidatePath("/", "layout")`):
    - `saveProviderAction` parses FormData into `ProviderConfigInput` (an empty API key field → `undefined`), calls `saveProviderConfig` then `testProviderConfig`, and returns `{ result }`.
    - `ValidationError` / `ForbiddenError` → `{ error: e.message }`. Anything else is logged with the error name and config id only (never FormData) and returns `{ error: "Something went wrong. Check the server logs." }`.
    - The other actions call their core function the same way.

- [ ] **Step 4: Run tests**

  Run: `pnpm lint && pnpm typecheck && pnpm e2e`
  Expected: PASS (auth, admin, and settings specs, 12 E2E tests).

- [ ] **Step 5: Commit**

  ```bash
  git add -A
  git commit -m "feat: add settings screen with provider test and activation"
  ```

---

### Task 10: Admin instance provider and usage

**Files:**
- Create: `packages/core/src/services/usage/{service.ts,index.ts}`, `apps/web/src/app/(app)/admin/instance-provider.tsx`, `e2e/instance-provider.spec.ts`
- Modify: `apps/web/src/app/(app)/admin/{page.tsx,actions.ts}`, `playwright.config.ts` (project `instance-provider`, `testMatch: "instance-provider.spec.ts"`, `dependencies: ["settings"]`)
- Test: `packages/core/src/services/usage/service.int.test.ts`, `e2e/instance-provider.spec.ts`

**Interfaces:**
- Consumes: `getInstanceProviderConfig`, `setInstanceProviderConfig`, `testProviderConfig` (Task 7); `ProviderForm`, `ProbeResults` (Task 9); `assertAdmin`.
- Produces (`@pathwise/core/services/usage`): `usageByUser(db, actorId, since)` (contract §4). Rows are ordered by email ascending, then role in the order `main`, `fast`, `embedding`; users without usage are omitted.

- [ ] **Step 1: Write the failing tests**

  ```ts
  // packages/core/src/services/usage/service.int.test.ts
  import { beforeEach, expect, it } from "vitest";
  import { getTestDb, resetDb } from "../../../../../test/integration/db";
  import { seedUser } from "../../../../../test/integration/fixtures";
  import { schema } from "../../db";
  import { ForbiddenError } from "../../errors";
  import { usageByUser } from ".";

  const db = getTestDb();
  const day = 86_400_000;
  const row = (userId: string, role: string, inputTokens: number, outputTokens: number, ageDays = 0) =>
    ({ userId, role, inputTokens, outputTokens, model: "m", purpose: "chat", createdAt: new Date(Date.now() - ageDays * day) });
  beforeEach(async () => {
    await resetDb(db);
    await seedUser(db, "adm", "admin");
    await seedUser(db, "u1");
    await seedUser(db, "u2");
    await db.insert(schema.llmUsage).values([row("u1", "main", 100, 10), row("u1", "main", 50, 5), row("u1", "fast", 7, 3),
      row("u1", "main", 1000, 1000, 40), row("adm", "embedding", 12, 0)]);
  });

  it("sums tokens per user and role since a date", async () => {
    expect(await usageByUser(db, "adm", new Date(Date.now() - 30 * day))).toEqual([
      { userId: "adm", email: "adm@x.io", role: "embedding", inputTokens: 12, outputTokens: 0 },
      { userId: "u1", email: "u1@x.io", role: "main", inputTokens: 150, outputTokens: 15 },
      { userId: "u1", email: "u1@x.io", role: "fast", inputTokens: 7, outputTokens: 3 },
    ]);
  });
  it("is admin-only", async () => {
    await expect(usageByUser(db, "u1", new Date(0))).rejects.toBeInstanceOf(ForbiddenError);
  });
  ```

  ```ts
  // e2e/instance-provider.spec.ts — runs after settings.spec.ts; Bob (created by admin.spec.ts) has no provider of his own
  import { type Browser, expect, type Page, test } from "@playwright/test";

  test.describe.configure({ mode: "serial" });
  const CONNECT = "Connect an AI provider to use the coach";

  async function signIn(page: Page, email: string, password: string) {
    await page.goto("/sign-in");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("heading", { name: /^Welcome, / })).toBeVisible();
  }
  const bob = async (browser: Browser) => {
    const page = await (await browser.newContext()).newPage();
    await signIn(page, "bob@example.com", "bobs-long-password");
    return page;
  };

  test("a member without a provider sees the setup prompt", async ({ browser }) => {
    await expect((await bob(browser)).getByText(CONNECT)).toBeVisible();
  });

  test("the admin sets the instance provider and sees usage", async ({ page }) => {
    await signIn(page, "ada@example.com", "a-very-long-password");
    await page.goto("/admin");
    const section = page.getByRole("region", { name: "Instance provider" });
    await section.getByLabel("Provider", { exact: true }).click();
    await page.getByRole("option", { name: "Anthropic", exact: true }).click();
    await section.getByLabel("Label", { exact: true }).fill("Team Anthropic");
    await section.getByLabel("API key").fill("sk-ant-test-9999");
    await section.getByLabel("Main model").fill("claude-sonnet-5-5");
    await section.getByLabel("Fast model").fill("claude-haiku-5-5");
    await section.getByRole("button", { name: "Save and test" }).click();
    await expect(section.getByText("Full support. All coach features are available.")).toBeVisible();
    await expect(section.getByText("••••9999")).toBeVisible();
    await page.reload();
    const usage = page.getByRole("table", { name: "Usage (last 30 days)" });
    await expect(usage.getByRole("cell", { name: "ada@example.com" }).first()).toBeVisible();
  });

  test("members fall back to the instance provider", async ({ browser }) => {
    await expect((await bob(browser)).getByText(CONNECT)).toHaveCount(0);
  });
  ```

- [ ] **Step 2: Run tests to verify they fail**

  Run: `pnpm test:int packages/core/src/services/usage && pnpm e2e`
  Expected: FAIL. `usageByUser` and the admin sections are missing.

- [ ] **Step 3: Implement**

  - **`usageByUser`:** `assertAdmin`. Join `llm_usage` with `user` where `created_at >= since`, group by user and role, `sum(...)` mapped with `Number`, ordered by email, then `array_position(array['main','fast','embedding'], role)`.
  - **Admin page:** two cards before "Sign-up", each wrapped in `<section aria-labelledby>` so it is a named region.
    - **"Instance provider"** (h2):
      - Note: "Used by everyone who hasn't connected their own provider. Usage is billed to this key."
      - When a config exists, a summary line: label, provider name, status badge (as in Task 9), `••••<last4>`, and a "Test" button.
      - `ProviderForm` with `scope="instance"`, no `embeddingOptions` (so no "Embedding provider" select), `allowCustom = customEndpoints !== "off"`, and `initial` = the current instance config.
      - `ProbeResults` after Save and test or Test.
    - **"Usage (last 30 days)"** (h2): a table with `aria-label="Usage (last 30 days)"` and columns User, Role, Input tokens, Output tokens (numbers via `toLocaleString("en-US")`). Empty state: "No usage yet."
  - **Admin actions** (`requireAdmin()`):
    - `saveInstanceProviderAction` calls `setInstanceProviderConfig`, then `testProviderConfig(getServer(), { userId, role: "admin" }, id)`.
    - `testInstanceProviderAction` re-tests.
    - Error mapping as in Task 9, then `revalidatePath("/", "layout")`.

- [ ] **Step 4: Run tests**

  Run: `pnpm test && pnpm test:int && pnpm lint && pnpm typecheck && pnpm e2e && bash scripts/compose-smoke.sh`
  Expected: all PASS (15 E2E tests), `SMOKE OK`.

- [ ] **Step 5: Commit**

  ```bash
  git add -A
  git commit -m "feat: add admin instance provider and per-user usage"
  ```
