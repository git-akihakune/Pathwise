# Adding a provider

Read [spec §4.4](superpowers/specs/2026-10-12-pathwise-design.md) and the [architecture guide](architecture.md). All LLM access goes through core’s provider layer. There is no vendor fallback key: the user’s provider wins over the instance provider, and without a usable provider coach features prompt for setup while manual editing remains available.

## First consider OpenAI compatibility

An endpoint implementing OpenAI chat completions can already use `openai_compatible`: set its base URL (usually ending in `/v1`), model ids, optional key, and context window in Settings. [factory.ts](../packages/core/src/llm/factory.ts) uses `createOpenAICompatible(...).chatModel(id)` (the `/chat/completions` path, normally `/v1/chat/completions`) and rejects redirects for custom endpoints. Built-in OpenAI uses `createOpenAI(...)(id)`, which selects the Responses API (`/v1/responses`) in the installed SDK; do not substitute a chat-completions-only endpoint into that branch. First-party URLs are explicitly pinned: Anthropic `https://api.anthropic.com/v1`, OpenAI `https://api.openai.com/v1`, and Google `https://generativelanguage.googleapis.com/v1beta`. They do not inherit SDK key or base-URL environment defaults.

## Implementation checklist

1. Add the provider to `ProviderKind` in [llm/types.ts](../packages/core/src/llm/types.ts) and the `provider_configs_kind` database check constraint in [providers.ts](../packages/core/src/db/schema/providers.ts). Generate and commit the migration with `pnpm --filter @pathwise/core db:generate`.
2. Add the SDK dependency to core, and a branch in `createLanguageModel` in [factory.ts](../packages/core/src/llm/factory.ts). Pass the stored, server-decrypted key explicitly and pin the intended base URL. Update `createEmbeddingModel` if the provider supports embeddings; otherwise return null. Keep mock mode ahead of live factory branches.
3. Update [models.ts](../packages/core/src/llm/models.ts): `MODEL_SUGGESTIONS`, model-specific `CONTEXT_WINDOWS`, `staticPdfInput`, and `contextWindowFor`. Custom endpoints default to 8,192 tokens and have `pdfInput: false`; unknown first-party models currently use 128,000 tokens. A new provider should claim only its actual capabilities.
4. Extend validation and kind-specific requirements in [provider services](../packages/core/src/services/providers/service.ts), [provider-input.ts](../apps/web/src/lib/provider-input.ts), and the Settings/Admin/onboarding option in [provider-form.tsx](../apps/web/src/components/provider-form.tsx). Check secret handling, custom URL policy, and the user/instance resolution rules in [resolve.ts](../packages/core/src/llm/resolve.ts).
5. Update harness allowlists in [evals/env.ts](../evals/src/env.ts) if live evals should support the new kind. Local smoke intentionally tests OpenAI-compatible servers.

## Probe and fallback contract

The Settings save action saves the config and then tests it; on-demand re-testing also runs [probeCapabilities](../packages/core/src/llm/probe.ts). Basic completion must return text; streaming must yield at least two nonempty chunks; the tool check must call `echo` with valid input; JSON schema output must validate. If fast differs from main, its basic completion is tested too. Each check has a 60-second timeout. Results are stored on the config.

| Status | Meaning |
|---|---|
| `untested` | No successful test yet; resolution cannot activate it |
| `full` | Basic, streaming, tools, and JSON schema checks pass |
| `degraded` | Basic and streaming pass; tools or JSON schema fail |
| `unsupported` | Basic or streaming fails; cannot activate |

`pdfInput` and `contextWindow` come from the static/user-entered metadata, not live probe requests. Authentication rejection marks the config and stops further affected LLM jobs until re-test.

Preserve fallbacks in [generate.ts](../packages/core/src/llm/generate.ts) and [turn.ts](../packages/core/src/agent/turn.ts):

- No native JSON schema: include the schema in a prompted JSON request, parse and validate with Zod, then retry once with validation errors for repair.
- No tools: omit tools from coach chat, retain retrieved context, and let post-session curation produce Proposals. Do not invent text-parsed tool execution.
- No PDF input: extract text; ask users to paste text for scanned PDFs.
- No embedding model: use full-text retrieval alone. Embeddings may use a separate provider config.

## Verification without keys

Write unit tests for model metadata, factory selection, input validation, secret handling, and status mapping. Run provider service/resolution and probe integration tests with AI SDK mock models, including degraded, unsupported, auth rejection, user-over-instance selection, and a separate embedding config. Exercise structured-output repair and tool-free turn integration. Add mock fixtures for any new purpose plus a mock Settings E2E case. `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm test:int` must pass without API keys. Real-provider probes and [manual evals](../CONTRIBUTING.md) are additional checks, never CI dependencies.
