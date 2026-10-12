# Pathwise v1 plans 2–6: cross-plan contract

Written 2026-10-12, before Plans 2–6 were implemented. Section 9 lists the amendments made while the plans were drafted; where §9 and an earlier section disagree, §9 wins, and where a plan and this file disagree, the plan wins.

This file is the single source of cross-plan decisions. Every plan must use exactly these
names, files, tables, and signatures. A plan may add private helpers, but anything another plan
consumes is listed here. Where this contract resolves a spec gap, the owning plan says so in a
"Spec gaps resolved" note near its top.

## 0. Ground rules (apply to every plan)

- Repo state: Plan 1 is merged (see `docs/superpowers/plans/2026-10-12-v1-plan-1-foundation.md` and
  the real code). Plans 3–6 are drafted before Plans 2–5 are implemented, so each plan's header
  must say: "Drafted before Plan N-1 was implemented. Before starting, check every *Consumes*
  signature against the merged code and fix the plan where they differ."
- Existing conventions to follow:
  - Core functions take `db: Db` first, then `userId` (or `actorId` for admin ops). Example:
    `createExperience(db, userId, input)`. Admin ops call `assertAdmin(db, actorId)` first.
  - Core subpath exports: `"./*": "./src/*/index.ts"` → `@pathwise/core/<dir>`; nested dirs work
    too (`@pathwise/core/services/profile` → `src/services/profile/index.ts`).
  - Tests: `*.test.ts` unit (no Docker), `*.int.test.ts` integration (Testcontainers; use
    `getTestDb()`, `resetDb()` from `test/integration/db.ts`; `resetDb` truncates ALL public tables,
    so integration tests seed whatever reference data they need).
  - Errors: `ConfigError`, `ForbiddenError`, `NotFoundError` exist in `@pathwise/core/errors`.
    Plans add `ConflictError` (Plan 3) and `LlmUnavailableError` (Plan 2) there.
  - Web: `getServer()` in `apps/web/src/lib/server.ts` (memoized `{ config, db, auth }`);
    `requireSession()` / `requireAdmin()` in `apps/web/src/lib/session.ts` returning
    `{ userId, name, email, role }`. Server actions live next to pages as `actions.ts`.
  - Nav (`apps/web/src/components/app-nav.tsx`) gains links as screens arrive:
    Plan 2 "Settings" (`/settings`); Plan 3 "Profile" (`/profile`), "Stories" (`/stories`),
    "Plan" (`/plan`); Plan 4 "Coach" (`/coach`). Final order: Today, Coach, Plan, Profile,
    Stories, Settings, Admin.
  - E2E tests run against the compose stack (`pnpm e2e`, port 3100). From Plan 2 on,
    `scripts/e2e.sh` exports `LLM_MODE=mock`. `e2e/auth.spec.ts` asserts the Today heading
    `Welcome, {name}`; keep that heading on Today in every plan.
  - New env vars: add to `BaseConfig` + `loadBaseConfig` + its test, `compose.yaml` `x-app-env`
    as `${VAR:-default}`, and `.env.example` (commented, with default and a one-line note).
  - Every LLM call goes through Plan 2's `llm` layer (never `ai` directly from services), so usage
    is recorded and mock mode works.
  - Logs are content-free unless `config.logContent`.
- Versions to pin (Global Constraints of each plan list the ones it adds):
  `ai` 7.0.x, `@ai-sdk/anthropic` 4.x, `@ai-sdk/openai` 4.x, `@ai-sdk/google` 4.x,
  `@ai-sdk/openai-compatible` 3.x, `@ai-sdk/react` 4.x, `@ai-sdk/otel` 1.x, `pg-boss` 12.x
  (already installed), `unpdf` 1.x, `mammoth` 1.x, `nodemailer` 10.x, `@react-email/components`
  1.x, `@react-email/render` 2.x, `date-fns` 4.x, `@date-fns/tz` 1.x, `fflate` 0.8.x.

## 1. AI SDK 7 facts (verified against ai@7.0.138; after `pnpm install` the docs ship in
`node_modules/ai/docs` and the mocks' types in `node_modules/ai/dist/test/index.d.ts`)

- `system` is renamed `instructions`. System messages inside `messages` are rejected by default.
- Lifecycle callbacks: `onFinish` → `onEnd`, `onStepFinish` → `onStepEnd`.
- Stop conditions: `stopWhen: isStepCount(n)` (was `stepCountIs`).
- Structured output: `generateText({ output: Output.object({ schema }) })`, result `.output`.
  `generateObject` still exists but use `generateText` + `Output.object`.
- Tools: `tool({ description, inputSchema: z.object(...), execute })`.
- Mocks from `ai/test`: `MockLanguageModelV4` (`doGenerate`, `doStream`), `MockEmbeddingModelV4`,
  `mockValues`; `simulateReadableStream` from `ai`. Usage shape:
  `{ inputTokens: { total, noCache, cacheRead, cacheWrite }, outputTokens: { total, text, reasoning } }`,
  `finishReason: { unified: "stop", raw: undefined }`.
- UI streaming: `createUIMessageStreamResponse({ stream: toUIMessageStream({ stream: result.stream,
  originalMessages, generateMessageId, onEnd: ({ messages, responseMessage, isAborted }) => … }) })`.
  `convertToModelMessages(uiMessages)` is async. `result.consumeStream()` (no await) makes the
  server finish even if the client disconnects.
- Client: `useChat({ id, messages, transport: new DefaultChatTransport({ api, prepareSendMessagesRequest }) })`
  from `@ai-sdk/react` / `ai`; `sendMessage({ text })`.
- Errors: `APICallError` (from `ai`/`@ai-sdk/provider`, has `statusCode`, `isInstance`),
  `RetryError`, `NoObjectGeneratedError`, `StreamProviderError`.
- `createOpenAICompatible({ name, baseURL, apiKey, supportsStructuredOutputs })`.
- Embeddings: `embed({ model, value })`, `embedMany({ model, values })`; `cosineSimilarity`.
- Telemetry: `registerTelemetry(new OpenTelemetry())` with `OpenTelemetry` from `@ai-sdk/otel`.

## 2. Module layout (packages/core/src)

```
crypto/            Plan 2  AES-256-GCM, keyring, rotation
llm/               Plan 2  provider factory, roles, probe, structured output, usage, mock mode
  mock/            Plan 2  mock models + fixture registry; later plans add fixtures
services/
  providers/       Plan 2  provider_configs CRUD, activation, custom-endpoint policy
  settings/        Plan 2  user_settings (Plan 5 adds check-in schedule functions)
  usage/           Plan 2  llm_usage queries (admin per-user usage)
  profile/         Plan 3  experiences, education, skills
  memory/          Plan 3  memory_items CRUD + status changes
  stories/         Plan 3
  paths/           Plan 3  career_paths
  plan/            Plan 3  plans, milestones, actions
  proposals/       Plan 3  proposals engine
  sessions/        Plan 4  sessions + messages
  documents/       Plan 5
  checkins/        Plan 5
  account/         Plan 6  export + delete
taxonomy/          Plan 3  snapshot import + queries
agent/             Plan 4  turn runtime, context assembler, classifier, skill registry
  skills/          Plan 4 (core, direction, planning); Plan 5 (intake, checkin)
memory/            Plan 4  retrieval (hybrid RRF), curator, dedupe, embeddings, snapshot
jobs/              Plan 4  job names, payload schemas, JobQueue port, handlers registry
workflows/         Plan 5  engine + onboarding, checkin definitions
mail/              Plan 5  transport, React Email templates, .ics
seed/              Plan 6  demo persona
```

Schema files (`packages/core/src/db/schema/`, all re-exported from `schema/index.ts`):
`providers.ts` (Plan 2: provider_configs, user_settings, llm_usage), `profile.ts` (Plan 3:
experiences, education, skills, memory_items, stories), `direction.ts` (Plan 3: career_paths,
plans, milestones, actions), `proposals.ts` (Plan 3), `taxonomy.ts` (Plan 3), `columns.ts`
(Plan 3: shared custom column types), `conversation.ts` (Plan 4: sessions, messages,
user_snapshot), `workflows.ts` (Plan 5: workflow_runs, checkins, documents).
Plan 2 also modifies `instance.ts` (instance_provider_config_id); Plan 4 adds
`safety_resources` to `instance_settings`.

## 3. Shared column conventions

- User-owned tables: `id uuid pk defaultRandom`, `user_id text not null references user(id) on delete cascade`,
  `created_at`, `updated_at timestamptz not null default now()`; proposal targets also `version integer not null default 1`.
  Services bump `version` and `updated_at` on every update.
- `columns.ts` (Plan 3) exports `anyVector` = drizzle `customType` for an unconstrained pgvector
  `vector` column (no fixed dimension, so any embedding model works; no ANN index in v1 — exact
  scan per user is fast enough at v1 scale), and `tsvector` customType. Embedding columns are
  paired with an `embedding_model text` column; similarity only compares rows whose
  `embedding_model` equals the current model id. A content change sets `embedding = null`.
- Full-text columns: `search tsvector generated always as (to_tsvector('english', …)) stored` with a GIN index.
- Plan 3's first migration runs `create extension if not exists vector` (custom migration via
  `drizzle-kit generate --custom`).

## 4. Plan 2 — LLM provider layer: produced interfaces

Env: `LLM_MODE` (`live` | `mock`, default `live`) → `BaseConfig.llmMode`.

Tables (`providers.ts`):
- `provider_configs`: id uuid, user_id text nullable (null = instance-wide), kind text
  (`anthropic`|`openai`|`google`|`openai_compatible`), label, base_url nullable, encrypted_key
  nullable, models jsonb `{ main: string; fast: string; embedding?: string; embeddingProviderConfigId?: string }`,
  context_window integer nullable, capabilities jsonb nullable, status text default `untested`
  (`untested`|`full`|`degraded`|`unsupported`), auth_failed boolean default false, last_tested_at, created_at, updated_at.
- `user_settings`: user_id pk → user cascade, provider_config_id nullable → provider_configs
  on delete set null, bluntness smallint default 3 (check 1–5), timezone text nullable (null ⇒
  treated as UTC; a client component saves the browser zone once), checkin_enabled bool default
  true, checkin_day smallint default 0 (0 = Sunday … 6), checkin_time text default '18:00',
  email_enabled bool default true, profile_version integer default 0 (Plan 3 bumps it), created_at, updated_at.
- `llm_usage`: id, user_id, provider_config_id nullable (set null), model, role, purpose,
  input_tokens, output_tokens, created_at.
- `instance_settings.instance_provider_config_id` nullable → provider_configs set null.

```ts
// @pathwise/core/crypto
export interface Keyring { current: Buffer; others: Buffer[] }      // others: .next/.previous files
export function keyId(key: Buffer): string;                          // first 8 hex of sha256
export function encryptSecret(keyring: Keyring, plaintext: string, aad: string): string; // "v1:<keyId>:<iv>:<tag>:<ct>" base64url parts
export function decryptSecret(keyring: Keyring, payload: string, aad: string): string;   // picks key by keyId
export function loadKeyring(config: Pick<AppConfig, "appEncryptionKey" | "secretsDir">): Keyring;
export function rotateEncryptionKey(db: Db, config: AppConfig, env: NodeJS.ProcessEnv): Promise<{ rotated: number }>;
// AAD for provider keys is the provider_configs.id.

// @pathwise/core/llm
export type ProviderKind = "anthropic" | "openai" | "google" | "openai_compatible";
export type ModelRole = "main" | "fast" | "embedding";
export type ProviderStatus = "untested" | "full" | "degraded" | "unsupported";
export interface Capabilities { basic: boolean; streaming: boolean; tools: boolean; jsonSchema: boolean; pdfInput: boolean; contextWindow: number }
export type LlmPurpose = string;   // e.g. "probe", "chat", "classify", "extract.document"; each plan documents its purposes
export interface Llm {
  userId: string;
  providerConfigId: string;
  kind: ProviderKind;
  capabilities: Capabilities;
  model(role: "main" | "fast", purpose: LlmPurpose): LanguageModel; // mock mode: purpose selects the fixture
  modelId(role: ModelRole): string | null;
  embedding: { model: EmbeddingModel; modelId: string; providerConfigId: string } | null;
}
export interface LlmDeps { db: Db; config: AppConfig }
export function resolveLlm(deps: LlmDeps, userId: string): Promise<Llm | null>; // user config → instance config → null; null if auth_failed or unsupported
export function generateStructured<T>(deps: LlmDeps, llm: Llm, opts: {
  role: "main" | "fast"; purpose: LlmPurpose; schema: z.ZodType<T>;
  instructions: string; prompt?: string; messages?: ModelMessage[];
}): Promise<T>;  // native Output.object when capabilities.jsonSchema, else prompted JSON + Zod + one repair retry; throws StructuredOutputError; records usage; marks auth failure
export function generateTextFor(deps: LlmDeps, llm: Llm, opts: { role: "main" | "fast"; purpose: LlmPurpose; instructions: string; prompt?: string; messages?: ModelMessage[] }): Promise<string>;
export function embedTexts(deps: LlmDeps, llm: Llm, purpose: LlmPurpose, values: string[]): Promise<number[][] | null>; // null when no embedding model
export function recordUsage(db: Db, row: { userId: string; providerConfigId: string | null; model: string; role: ModelRole; purpose: LlmPurpose; inputTokens: number; outputTokens: number }): Promise<void>;
export function isAuthError(e: unknown): boolean;                    // APICallError with 401/403
export function markAuthFailed(db: Db, providerConfigId: string): Promise<void>; // status=degraded, auth_failed=true
export class StructuredOutputError extends Error { issues: string[] }
export function estimateTokens(text: string): number;               // Math.ceil(text.length / 4)
export function probeCapabilities(deps: LlmDeps, target: ProbeTarget): Promise<{ capabilities: Capabilities; status: ProviderStatus; checks: Record<"basic"|"streaming"|"tools"|"jsonSchema", { ok: boolean; error?: string }> }>;

// @pathwise/core/llm (mock)
export interface MockCall { purpose: LlmPurpose; role: "main" | "fast"; lastUserText: string; system: string; toolNames: string[] }
export type MockReply = { text: string } | { json: unknown } | { toolCalls: { toolName: string; input: unknown }[]; text?: string };
export function registerMockFixture(purpose: LlmPurpose | "*", fixture: (call: MockCall) => MockReply): void;
export function createMockModel(role: "main" | "fast", purpose: LlmPurpose): LanguageModel; // streams text in ≥2 chunks; after a tool result it replies with text
// Fixtures live in packages/core/src/llm/mock/fixtures/*.ts and are registered from mock/fixtures/index.ts.
// Default "*" fixture: { text: "Mock reply." }. Mock embedding model: deterministic 8-dim vector from a hash of the text.

// @pathwise/core/services/providers
export interface ProviderConfigInput { kind: ProviderKind; label: string; baseUrl?: string; apiKey?: string; models: { main: string; fast: string; embedding?: string; embeddingProviderConfigId?: string }; contextWindow?: number }
export interface ProviderConfigView { id: string; scope: "user" | "instance"; kind; label; baseUrl: string | null; keyLast4: string | null; models; contextWindow: number | null; capabilities: Capabilities | null; status: ProviderStatus; authFailed: boolean; lastTestedAt: Date | null }
export function saveProviderConfig(deps: LlmDeps, actor: { userId: string; role: "admin" | "user" }, input: ProviderConfigInput & { id?: string; scope: "user" | "instance" }): Promise<ProviderConfigView>; // enforces CUSTOM_ENDPOINTS + private-address policy; apiKey omitted on update keeps the old key
export function testProviderConfig(deps: LlmDeps, actor, id: string): Promise<ProviderConfigView & { checks }>;
export function listProviderConfigs(db: Db, userId: string): Promise<ProviderConfigView[]>;
export function activateProviderConfig(db: Db, userId: string, id: string): Promise<void>;   // ConflictError-like error if unsupported/untested
export function deleteProviderConfig(db: Db, userId: string, id: string): Promise<void>;
export function getInstanceProviderConfig(db: Db, actorId: string): Promise<ProviderConfigView | null>;
export function setInstanceProviderConfig(deps: LlmDeps, actorId: string, input: ProviderConfigInput): Promise<ProviderConfigView>;
export function getProviderStatusForUser(db: Db, userId: string): Promise<{ source: "user" | "instance" | "none"; authFailed: boolean; status: ProviderStatus | null }>;

// @pathwise/core/services/settings
export interface UserSettings { providerConfigId: string | null; bluntness: 1|2|3|4|5; timezone: string | null; checkinEnabled: boolean; checkinDay: number; checkinTime: string; emailEnabled: boolean; profileVersion: number }
export function getUserSettings(db: Db, userId: string): Promise<UserSettings>;   // inserts defaults if missing
export function updateUserSettings(db: Db, userId: string, patch: Partial<Pick<UserSettings, "bluntness" | "timezone">>): Promise<UserSettings>; // validates IANA tz via Intl
export function effectiveTimezone(s: UserSettings): string;          // timezone ?? "UTC"

// @pathwise/core/services/usage
export function usageByUser(db: Db, actorId: string, since: Date): Promise<{ userId: string; email: string; role: ModelRole; inputTokens: number; outputTokens: number }[]>;
```

CLI: `pathwise admin rotate-encryption-key`.
Web: `/settings` (Provider, Coach: bluntness + timezone), `/admin` gains "Instance provider" and
"Usage (last 30 days)" sections; a `ProviderBanner` in `(app)/layout.tsx` shows
"Your API key was rejected" → Settings when `authFailed`, or "Connect an AI provider to use the
coach" when source is `none`.

## 5. Plan 3 — Domain & taxonomy: produced interfaces

Errors: `ConflictError` added to `@pathwise/core/errors`.

Tables: experiences, education, skills, memory_items, stories (profile.ts); career_paths,
plans, milestones, actions (direction.ts); proposals (proposals.ts; `session_id`/`message_id`
are plain nullable uuid columns now, Plan 4 adds the FKs); occupations, taxonomy_skills,
occupation_skills, occupation_relations, taxonomy_meta (taxonomy.ts). Columns per spec §6.2–6.5
plus: `occupations.tasks text[]` (O*NET task statements, top 10 by importance; empty for ESCO —
needed by the `getOccupation` tool, spec §5.3), `memory_items.embedding_model`,
`stories.embedding_model`, `taxonomy_meta(id smallint pk 1, version text, imported_at)`.
`plans`: partial unique index on (user_id) where status = 'active'.
Every profile/memory mutation that changes the active set bumps `user_settings.profile_version`
in the same transaction (upserting the settings row).

```ts
// @pathwise/core/services/profile
export type SourceType = "cv" | "linkedin" | "message" | "checkin" | "manual";
export interface Experience { id; title; organization: string | null; startDate: string | null; endDate: string | null; description: string | null; highlights: string[]; sourceType: SourceType; sourceId: string | null; version: number }
export interface Education { id; institution; qualification: string | null; field: string | null; startDate; endDate; sourceType; sourceId; version }
export type SkillLevel = "basic" | "working" | "strong" | "expert";
export interface Skill { id; name; level: SkillLevel | null; taxonomySkillId: string | null; evidence: string | null; sourceType; sourceId; version }
export interface Profile { experiences: Experience[]; education: Education[]; skills: Skill[] }
export function getProfile(db: Db, userId: string): Promise<Profile>;
export function createExperience / updateExperience(db, userId, id, patch, expectedVersion?) / deleteExperience(db, userId, id)
// same trio for Education and Skill (createSkill auto-links taxonomySkillId by case-insensitive exact name match)
// update* with expectedVersion throws ConflictError on mismatch.

// @pathwise/core/services/memory
export type MemoryCategory = "value"|"constraint"|"aspiration"|"energizer"|"drain"|"preference"|"fact"|"event"|"observation";
export type MemoryStatus = "active" | "pending" | "rejected" | "superseded";
export interface MemoryItem { id; category: MemoryCategory; content: string; sourceType: SourceType; sourceId: string | null; confidence: number; sensitive: boolean; status: MemoryStatus; supersedesId: string | null; version: number; createdAt: Date }
export function listMemory(db, userId, filter?: { status?: MemoryStatus[]; categories?: MemoryCategory[] }): Promise<MemoryItem[]>;
export function addMemory(db, userId, input: Omit<MemoryItem, "id"|"version"|"createdAt"|"supersedesId"> & { supersedesId?: string }): Promise<MemoryItem>; // supersedesId marks the old item superseded
export function updateMemory(db, userId, id, patch: { content?: string; category?: MemoryCategory }, expectedVersion?): Promise<MemoryItem>;
export function setMemoryStatus(db, userId, id, status: "active" | "rejected"): Promise<void>; // confirm / dismiss pending
export function deleteMemory(db, userId, id): Promise<void>;
export const PROFILE_MEMORY_CATEGORIES: MemoryCategory[]; // value, constraint, aspiration, energizer, drain, preference

// @pathwise/core/services/stories
export interface Story { id; title; situation; task; action; result; metrics: string | null; skills: string[]; sourceType; sourceId; version }
export function listStories / getStory / createStory / updateStory(…, expectedVersion?) / deleteStory

// @pathwise/core/services/paths
export interface RouteStep { title: string; kind: "role" | "learning" | "project" | "network" | "other"; detail: string; isBridgeRole: boolean }
export interface SkillGap { skill: string; taxonomySkillId: string | null; importance: number; note: string }
export interface Feasibility { timeMonths: { min: number; max: number }; cost: string; risks: string[]; mustBeTrue: string[] }
export interface CareerPathInput { title; occupationCodes: string[]; rationale: string; route: RouteStep[]; skillGaps: SkillGap[]; feasibility: Feasibility }
export interface CareerPath extends CareerPathInput { id; status: "explored" | "chosen" | "dismissed"; version; createdAt }
export function listPaths / savePath(db, userId, input) / setPathStatus(db, userId, id, status) / deletePath
export const careerPathInputSchema: z.ZodType<CareerPathInput>;

// @pathwise/core/services/plan
export interface Milestone { id; title; description: string | null; targetDate: string | null; position: number; status: "open"|"done"|"dropped"; version }
export interface Action { id; milestoneId: string | null; title; notes: string | null; weekOf: string /* YYYY-MM-DD Monday */; status: "todo"|"done"|"skipped"; doneAt: Date | null; version }
export interface ActivePlan { id; northStar: string; careerPathId: string | null; version; milestones: Milestone[]; actions: Action[] }
export function getActivePlan(db, userId): Promise<ActivePlan | null>;
export function createPlan(db, userId, input: { northStar; careerPathId?: string; milestones: {title; description?; targetDate?}[]; actions: {title; notes?; weekOf; milestoneIndex?: number}[] }): Promise<ActivePlan>; // archives the previous active plan; marks the path chosen
export function updatePlan / addMilestone / updateMilestone / removeMilestone / addAction / updateAction / removeAction (structural edits bump plans.version)
export function setActionStatus(db, userId, actionId, status, expectedVersion?): Promise<Action>; // does NOT bump plans.version
export function mondayOf(date: Date, timeZone: string): string; // YYYY-MM-DD
export function actionsForWeek(db, userId, weekOf: string): Promise<Action[]>;

// @pathwise/core/services/proposals
export type ProposalKind = "profile_update"|"memory_add"|"memory_update"|"story_add"|"story_update"|"path_save"|"plan_create"|"plan_change"|"action_status_update";
export type ProposalStatus = "pending"|"approved"|"rejected"|"conflicted";
export const proposalPayloadSchemas: { [K in ProposalKind]: z.ZodType<ProposalPayload<K>> };
// payloads:
//  profile_update: { entity: "experience"|"education"|"skill"; op: "create"|"update"|"delete"; id?: string; fields?: Record<string, unknown> }   target = the row (update/delete)
//  memory_add: { category; content; sensitive: boolean }
//  memory_update: { id; content?; category? }                              target = memory item
//  story_add: StoryInput   story_update: { id; fields: Partial<StoryInput> } target = story
//  path_save: CareerPathInput
//  plan_create: { careerPathId?: string; northStar; milestones; actions }   (same shape as createPlan input)
//  plan_change: { northStar?: string; milestones: { add: …[]; update: { id; …}[]; remove: string[] }; actions: { add; update; remove } } target = active plan
//  action_status_update: { updates: { actionId: string; status: "done"|"skipped"|"todo"; basedOnVersion: number }[] } (per-item staleness)
export interface Proposal { id; kind: ProposalKind; payload: unknown; targetId: string | null; targetVersion: number | null; status: ProposalStatus; sessionId: string | null; messageId: string | null; createdAt: Date; resolvedAt: Date | null }
export function createProposal<K extends ProposalKind>(db, userId, input: { kind: K; payload: ProposalPayload<K>; sessionId?: string; messageId?: string }): Promise<Proposal>; // validates payload, reads target + version itself
export function listProposals(db, userId, filter?: { status?: ProposalStatus[]; sessionId?: string }): Promise<Proposal[]>;
export function getProposal(db, userId, id): Promise<Proposal>;
export function approveProposal(db, userId, id, opts?: { editedPayload?: unknown }): Promise<{ status: "approved" | "conflicted" }>; // one transaction; approved memory is always active
export function rejectProposal(db, userId, id): Promise<void>;

// @pathwise/core/taxonomy
export interface OccupationSummary { id: string; source: "onet"|"esco"; code: string; title: string; description: string }
export interface OccupationDetail extends OccupationSummary { altTitles: string[]; tasks: string[]; skills: { id: string; name: string; importance: number }[]; related: OccupationSummary[] }
export function importTaxonomySnapshot(db: Db, dir: string): Promise<{ imported: boolean; version: string }>; // no-op when taxonomy_meta.version equals manifest version
export function searchOccupations(db, query: string, opts?: { limit?: number; source?: "onet"|"esco" }): Promise<OccupationSummary[]>;
export function getOccupation(db, idOrCode: string): Promise<OccupationDetail | null>;
export function searchTaxonomySkills(db, query: string, limit?: number): Promise<{ id; name; source }[]>;
export function matchTaxonomySkill(db, name: string): Promise<string | null>;
export function skillGapsFor(db, userId: string, occupationId: string, limit?: number): Promise<SkillGap[]>; // important skills minus user's taxonomy-matched skills
```
Taxonomy files: `data/taxonomy/manifest.json` + `occupations.jsonl.gz`, `skills.jsonl.gz`,
`occupation_skills.jsonl.gz`, `relations.jsonl.gz`; build script `pnpm taxonomy:build`
(`scripts/taxonomy/build.ts`). `init` calls `importTaxonomySnapshot` after migrations; the image
copies `data/taxonomy` to `/app/data/taxonomy` (env `TAXONOMY_DIR`, default `/app/data/taxonomy`,
dev.env sets `./data/taxonomy`).

## 6. Plan 4 — Coach runtime: produced interfaces

Tables (`conversation.ts`): sessions, messages (spec §6.4), user_snapshot; adds FKs from
proposals.session_id/message_id; `instance_settings.safety_resources jsonb` default
`[{"name":"Find a Helpline","url":"https://findahelpline.com"}]`.

```ts
// @pathwise/core/jobs
export const JOBS = { sessionCurate: "session.curate", sessionSummarize: "session.summarize", memoryEmbed: "memory.embed", snapshotRefresh: "snapshot.refresh", maintenanceTick: "maintenance.tick" } as const; // Plan 5 adds checkinDispatch/Prepare/Followup, documentParse
export interface JobQueue { send(name: string, data: object, opts?: { startAfterSeconds?: number; singletonKey?: string }): Promise<void> }
export function pgBossQueue(boss: PgBoss): JobQueue;
export interface JobDeps extends LlmDeps { queue: JobQueue }
export interface JobDefinition<T> { name: string; schema: z.ZodType<T>; handler(deps: JobDeps, data: T): Promise<void>; cron?: string }
export function registerJobs(boss: PgBoss, deps: JobDeps, defs: JobDefinition<any>[]): Promise<void>; // createQueue with retryLimit 3, retryBackoff true, deadLetter "<name>.dead"; work(); schedule cron
export const coreJobs: JobDefinition<any>[]; // Plan 4's list; Plan 5 appends to it
// Change detection: maintenance.tick (cron * * * * *) enqueues snapshot.refresh for users whose user_snapshot.profile_version < user_settings.profile_version, and memory.embed for users with an embedding model and rows where embedding is null or embedding_model differs (singletonKey = userId).
// LLM jobs skip (return, no retry) when resolveLlm returns null; an auth error calls markAuthFailed and returns.

// @pathwise/core/services/sessions
export interface ChatSession { id; startedAt: Date; lastMessageAt: Date; endedAt: Date | null; topic: string | null; summary: string | null; workflowRunId: string | null }
export function getOrStartSession(db, userId, opts?: { topic?: string; workflowRunId?: string; now?: Date }): Promise<ChatSession>; // new session after a 6 h gap, or when topic/workflowRunId is given
export function appendMessage(db, userId, sessionId, msg: { id?: string; role: "user"|"assistant"; parts: UIMessage["parts"]; status?: "complete"|"interrupted"; inputTokens?: number; outputTokens?: number }): Promise<{ id: string }>;
export function recentMessages(db, userId, sessionId, limit?: number): Promise<UIMessage[]>;
export function listConversation(db, userId, opts?: { before?: Date; limit?: number }): Promise<{ session: ChatSession; messages: UIMessage[] }[]>;

// @pathwise/core/agent
export type SkillId = "core" | "direction" | "planning" | "intake" | "checkin";
export type Screen = "today" | "coach" | "profile" | "stories" | "plan";
export interface SkillContext { deps: LlmDeps; llm: Llm; userId: string; sessionId: string; messageId: string; timezone: string }
export interface Skill { id: SkillId; description: string; workflowOnly?: boolean; promptFragment(ctx: SkillContext): string; tools(ctx: SkillContext): ToolSet; contextProviders?: ContextProvider[] }
export interface ContextProvider { id: string; maxTokens: number; render(ctx: SkillContext): Promise<string> }
export function registerSkill(skill: Skill): void;
export function getSkill(id: SkillId): Skill;
export interface WorkflowTurn { runId: string; stepId: string; skills: SkillId[]; goal: string }
export interface TurnInput { userId: string; message: UIMessage; screen?: Screen; topic?: string; workflow?: WorkflowTurn }
export interface TurnDeps extends LlmDeps { queue: JobQueue }
export interface TurnResult { sessionId: string; assistantMessageId: string; status: "complete" | "interrupted"; text: string }
export function runTurn(deps: TurnDeps, input: TurnInput, hooks?: { onTurnEnd?: (r: TurnResult) => Promise<void> }): Promise<Response>; // UI message stream response
export function assembleContext(input: AssembleInput): AssembledContext;  // pure: budget = min(0.6*ctxWindow, 32000), caps per spec §5.2
export function selectSkills(input: { classified: SkillId[]; recent: SkillId[][]; screen?: Screen; workflow?: WorkflowTurn }): SkillId[];
export const SAFETY_RESPONSE: (resources: { name: string; url: string }[]) => string;

// @pathwise/core/memory
export function hybridSearch(deps: LlmDeps, llm: Llm | null, userId: string, query: string, opts?: { limit?: number }): Promise<RetrievedItem[]>; // RRF k=60 over memory_items(active), stories, sessions.summary
export function rrfFuse(lists: { id: string }[][], k?: number): string[];
export function curateSession(deps: JobDeps, userId: string, sessionId: string): Promise<CurateReport>;
export function refreshSnapshot(deps: LlmDeps, userId: string): Promise<void>;
export function getSnapshotText(db, userId): Promise<string>; // stored snapshot, or a deterministic compact fallback when none exists
```
Web: `/coach` (useChat; one continuous conversation with session dividers; "New focused session"
with topic), `POST /api/chat` (body `{ message, screen?, topic?, workflowRunId? }`; Plan 5 routes
`workflowRunId` to the workflow runtime), `ProposalCard` component
(`apps/web/src/components/proposal-card.tsx`; approve / edit-then-approve / reject; conflicted
state with "Regenerate against current data", which sends a chat message asking the coach to
redo the proposal), `PendingMemoryList` (confirm/dismiss pending memory) component.
Worker registers `coreJobs`.
Mock fixtures for purposes: `classify`, `chat`, `curate.extract`, `curate.dedupe`,
`session.summarize`, `snapshot`, `paths.generate`. E2E chat triggers: user text containing
"remember that" → `proposeMemory`; "save a story" → `proposeStory`; "suggest paths" →
`generateCareerPaths`; "make a plan" → `proposePlan`.

## 7. Plan 5 — Workflows & check-ins: produced interfaces

Tables (`workflows.ts`): workflow_runs, checkins (spec §6.4), documents (spec §6.2 plus
`extraction jsonb` holding the parse result for review).
Env: none new (SMTP already exists).

```ts
// @pathwise/core/workflows
export type WorkflowType = "onboarding" | "checkin";
export type StepKind = "conversational" | "compute" | "ui";
export interface WorkflowRun { id; type: WorkflowType; stepId: string; state: Record<string, unknown>; status: "active"|"needs_attention"|"completed"|"abandoned" }
export function startWorkflow(deps, userId, type, initialState?): Promise<WorkflowRun>; // at most one active run per (user, type)
export function getActiveRun(db, userId, type): Promise<WorkflowRun | null>;
export function advance(deps, userId, runId, input?: { uiResult?: unknown; skip?: boolean }): Promise<WorkflowRun>;
export function retryStep(deps, userId, runId): Promise<WorkflowRun>;
export function runWorkflowTurn(deps: TurnDeps, input: { userId; runId; message: UIMessage }): Promise<Response>; // wraps runTurn + fast completion check
// @pathwise/core/services/documents: uploadDocument, createPastedDocument, getDocument, listDocuments, sniffMime
// @pathwise/core/services/checkins: computeDueAt(settings, now), checkinWeekOf, createScheduledCheckin, markSent/Nudged/Completed/Missed
// @pathwise/core/services/settings (added): updateCheckinSchedule(db, userId, { enabled, day, time, emailEnabled })
// @pathwise/core/mail: createMailer(config) → { enabled; send(msg) }, templates, buildCheckinIcs({ uid, method, … })
```
Jobs added to `coreJobs`: `document.parse`, `checkin.dispatch` (cron `*/15 * * * *`),
`checkin.prepare`, `checkin.followup`.
Web: `/onboarding` (steps), `/checkin` (steps), Today screen (this week's actions, check-in status,
coach note, pending proposals, pending memories; keeps the `Welcome, {name}` heading),
Settings "Check-ins" section; Admin SMTP banner; auth emails (verification, reset) and invite
email when SMTP is configured.

## 8. Plan 6 — Hardening & showcase: produced interfaces

`@pathwise/core/seed` (`seedDemo(deps, opts)` idempotent), `@pathwise/core/services/account`
(`exportUserData`, `deleteAccount`), admin job health (queue stats, dead letters, retry),
`evals/`, `pnpm smoke:local`, OTEL wiring, docs, CONTRIBUTING, NOTICE (O*NET/ESCO attribution),
full E2E for every spec §11 E2E flow.

## 9. Amendments made while drafting the plans

These override the sections above. Each plan's "Spec gaps resolved" section has the reasoning.

- **Database handle (Plan 3):** services take `db: DbOrTx` (`Db | Tx`, exported from `@pathwise/core/db`) so the proposals engine can apply changes inside one transaction.
- **Errors:** `ValidationError` and `LlmUnavailableError` (Plan 2), `ConflictError` (Plan 3). `requireLlm(deps, userId)` throws `LlmUnavailableError` when `resolveLlm` returns null.
- **Provider configs (Plan 2):** `provider_configs.key_last4` column. `resolveLlm` returns null for untested, unsupported, auth-failed, or undecryptable configs and never falls back to the instance config when the user's own active config is unusable. Never use forced tool choice (current Anthropic models reject it with HTTP 400).
- **Test fixtures (Plan 2):** `test/integration/fixtures.ts` (`seedUser`, `insertConfig`, `testConfig`, `FULL_CAPS`) is the only place integration tests get users and provider configs.
- **Taxonomy (Plan 3):** O*NET 31.0 file names (`Essential Skills.txt`, `Transferable Skills.txt`, `Job Titles.txt`); ESCO is read from a local export (`--esco <dir>`). `SkillGap` and `skillGapsFor` live in `@pathwise/core/taxonomy`. `skills.taxonomy_skill_id` has no FK; dangling links are nulled after each import. `BaseConfig.taxonomyDir`, `InitReport.taxonomy`.
- **Proposals (Plan 3):** `plan_create` targets the active plan at proposal time and is `conflicted` if a different plan has since become active.
- **Messages (Plan 4):** message ids are UUIDs on client and server. `runTurn` inserts an assistant placeholder row before tools run (proposals reference it). `messages` has `skills text[]` and `seq`. `appendMessage` accepts `skills` and `createdAt`. Session functions return `CoachUIMessage`. Regenerate is inferred from an already-stored user message id. Chat calls `streamText` directly and records usage with `recordUsage`.
- **Jobs (Plan 4):** `JobDefinition.policy?: "standard" | "stately"`; pg-boss 12 only honours `singletonKey` on non-standard queues. Every job payload carries `userId` except the user-less crons `maintenance.tick` and `checkin.dispatch`. The web app's pg-boss instance is `getBoss()` in `apps/web/src/lib/jobs.ts`. `PendingMemoryList` is created by Plan 3 (`apps/web/src/components/pending-memory-list.tsx`).
- **Workflows (Plan 5):** step kinds `conversational | compute | ui`; `advance` takes the expected `stepId` so stale or double submits are ignored; extra engine functions `getRun`, `latestRun`, `abandonRun`, `checkStepCompletion`, `stepMessages`; `recordCompletedOnboarding(db, userId)`; `documents.storage_path` is `<userId>/<uuid>` relative to `FILES_DIR`. Today shows a "Set up your coach" card instead of redirecting to `/onboarding`. Check-in dispatch skips users without an active plan. `JobDeps` has no mailer; handlers call `mailerFor(config)`.
- **Bootstrap (Plan 6):** the first-admin rule becomes "no admin exists" (`evaluateSignup` takes `adminCount`), so a seeded demo user never takes the admin slot. `JobAdmin` port in `packages/core/src/jobs/admin.ts`; `packages/core/src/telemetry/`.
