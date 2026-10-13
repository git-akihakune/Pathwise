# Architecture

The [approved design](superpowers/specs/2026-10-12-pathwise-design.md) is the source of truth. This guide maps v1 to the implemented files.

```
┌───────────────────────── docker compose ──────────────────────────┐
│  ┌─ init (one-shot) ─┐                                            │
│  │ secrets · migrate │──── must exit 0 before web/worker start    │
│  │ taxonomy import   │                                            │
│  └───────────────────┘                                            │
│  ┌──────────── web (Next.js 16) ─────────────┐   ┌── worker ──┐   │
│  │ App Router UI · Route handlers (chat SSE) │   │ pg-boss    │   │
│  │ Server Actions · Better Auth   :3000      │   │ consumers  │   │
│  └───────────────┬───────────────────────────┘   └─────┬──────┘   │
│                  ▼  all three run the same image       ▼          │
│        ┌─────────────────── packages/core ───────────────────┐    │
│        │ agent runtime · skills · workflows · memory curator │    │
│        │ domain services · db (Drizzle) · llm · mail · crypto│    │
│        └───────────────────────┬─────────────────────────────┘    │
│        ┌─ postgres (pgvector) ─┐  ┌─ volumes ───────────────────┐ │
│        │ app data · job queue  │  │ pathwise-db · pathwise-files│ │
│        │ taxonomy · embeddings │  │ pathwise-secrets            │ │
│        └───────────────────────┘  └─────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────┘
        outbound only: LLM providers / custom endpoints, SMTP
```

## Packages and boundaries

- `packages/core` owns domain services, database access, the agent, provider resolution, workflows, memory, jobs, mail, and encryption. It must not import Next.js. User data goes through services taking `userId`.
- `apps/web` provides Next.js App Router pages, route handlers, Server Actions, and Better Auth integration. It delegates domain work to core.
- `apps/worker` provides pg-boss consumers, the one-shot `init`, and the `pathwise` CLI. All three entrypoints share one image; init creates secrets, migrates, imports the bundled taxonomy, and optionally seeds the demo before web and worker start.
- `evals/src/run.ts` parses arguments and compares saved runs without loading the live runtime. `evals/src/live.ts` is the boundary for Docker, database, providers, and live simulations. Offline comparison needs neither keys nor Docker.

## Request flow of a chat turn

1. `POST /api/chat` in [route.ts](../apps/web/src/app/api/chat/route.ts) calls `requireApiSession` from [session.ts](../apps/web/src/lib/session.ts), the API equivalent of the pages' `requireSession`, then validates the message and screen.
2. [runTurn](../packages/core/src/agent/turn.ts) resolves a usable provider, persists the user message through [session services](../packages/core/src/services/sessions/service.ts), and opens a session if needed (including a gap of more than six hours). Acute distress can use the fixed safety response without a provider.
3. [classify.ts](../packages/core/src/agent/classify.ts) uses the fast model to select extra skills and assess distress. Workflow turns instead supply their step's skills; keyword safety checks still run.
4. [select.ts](../packages/core/src/agent/select.ts) combines core, classified skills, the previous three turns' skills, and screen hints. [registry.ts](../packages/core/src/agent/registry.ts) supplies their prompts and tools.
5. [context.ts](../packages/core/src/agent/context.ts) assembles persona, snapshot, plan, skill context, retrieved memories/stories/summaries, and recent conversation within the model budget. `runTurn` calls `streamText` with the main model, adding tools only when supported. A context-length error retries once with a 30% smaller budget.
6. `createUIMessageStreamResponse` sends UI parts to the client: text, tool results, and approval cards. An assistant placeholder exists before tools run so Proposals can reference it.
7. On stream end, session services persist the complete or interrupted assistant message; [usage.ts](../packages/core/src/llm/usage.ts) records tokens. `session.curate` is scheduled for 30 minutes later, and `session.summarize` is queued when recent messages exceed 60% of their budget.

## Proposal approval

Write tools call [createProposal](../packages/core/src/services/proposals/service.ts), which validates payloads and captures target versions. They do not call mutating domain services. The UI displays a pending approval card; an authenticated Server Action invokes `approveProposal` with the user's id. Approval locks the Proposal and its owned target, checks versions, and applies domain services transactionally. A stale target produces `conflicted`; rejection changes only the Proposal status. Approval activates proposed memories even when sensitive. See [adding a skill](adding-a-skill.md).

## Workflows

[definitions.ts](../packages/core/src/workflows/definitions.ts) registers onboarding and check-in. [engine.ts](../packages/core/src/workflows/engine.ts) persists progress in `workflow_runs`, not model prompts. Steps are conversational (skills and goal), compute (server work), or UI (validated user input). Runs can be `active`, `needs_attention`, `completed`, or `abandoned`. Errors expose retry/manual paths. Workflow conversation delegates to the same coach, not specialist personas.

## Background jobs

Names and payloads live in [queue.ts](../packages/core/src/jobs/queue.ts) and [definitions.ts](../packages/core/src/jobs/definitions.ts); worker registration validates payloads. Jobs set a retry limit of three with exponential backoff and a `<name>.dead` queue. Admin can inspect counts, retry via redrive, and discard dead letters; counts can be cached up to a minute. Provider authentication failures pause affected LLM work until the config is re-tested. Model roles are `main` for coaching, `fast` for classification/extraction/summaries, and optional `embedding` for retrieval.

| Job | Trigger and work |
|---|---|
| `document.parse` | Upload; extract document data for onboarding review |
| `session.curate` | Idle conversation; route memories and propose stories/action status changes |
| `session.summarize` | Conversation exceeds its recent-message budget; refresh rolling summary |
| `memory.embed` | Maintenance finds missing/outdated memory, story, or summary embeddings |
| `snapshot.refresh` | Maintenance finds a changed profile version; refresh compact user context |
| `maintenance.tick` | Every minute; discover snapshot and embedding work |
| `checkin.dispatch` | Every 15 minutes; find due local check-in times |
| `checkin.prepare` | Prepare the week's check-in and optionally send email |
| `checkin.followup` | One nudge after 48 hours; final missed check at seven days from due |

## Mock mode and taxonomy

`LLM_MODE=mock` makes [factory.ts](../packages/core/src/llm/factory.ts) return deterministic AI SDK mock models. Fixtures under [llm/mock/fixtures](../packages/core/src/llm/mock/fixtures) are selected by purpose and message trigger; mock embeddings are deterministic too. CI runs without any LLM API keys.

The committed [manifest](../data/taxonomy/manifest.json) bundles O*NET 31.0; `sources.esco` and `sources.crosswalk` are null. ESCO is supported by the importer but absent from this snapshot. To build a combined snapshot, obtain an English ESCO 1.2.1 CSV export from [ESCO](https://esco.ec.europa.eu/), then run `pnpm taxonomy:build --esco /path/to/esco --crosswalk /path/to/crosswalk.csv` (crosswalk optional). The ESCO directory must contain `occupations_en.csv`, `skills_en.csv`, and `occupationSkillRelations_en.csv`. [build.ts](../scripts/taxonomy/build.ts) pins and verifies the O*NET archive; it can also take `--onet-zip` for a local copy and `--out` for an alternate snapshot directory. Review source versions and update [NOTICE](../NOTICE) when bundling ESCO. `init` imports by manifest version without a network fetch at boot.
