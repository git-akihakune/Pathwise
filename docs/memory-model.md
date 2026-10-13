# Memory model

The coach has structured profile data, reviewed memories, achievement stories, conversation summaries, and a compact snapshot. These are user-owned rows accessed through core services, not an unreviewable chat-only store. See [spec §§5–6](superpowers/specs/2026-10-12-pathwise-design.md).

## Categories, status, and provenance

[Memory services](../packages/core/src/services/memory/service.ts) define nine categories. Profile shows `value`, `constraint`, `aspiration`, `energizer`, `drain`, and `preference`. `fact`, `event`, and `observation` are other memory categories available to retrieval and review.

| Status | Use |
|---|---|
| `active` | Available to the coach |
| `pending` | Awaiting review; excluded from retrieval |
| `rejected` | User declined; excluded from retrieval |
| `superseded` | Replaced by a newer active memory; retained as history |

Rows carry `sourceType` (`cv`, `linkedin`, `message`, `checkin`, or `manual`), `sourceId`, confidence, sensitivity, version, and optional `supersedesId`. Curator memories use `sourceType: "message"` with the session id. A pending replacement keeps the old memory active until approval. Approving a memory Proposal always creates/sets an active memory, including sensitive content; approval is the user’s explicit choice. Manual editing and status review use the same domain services and version checks.

## Curator routing and deduplication

[curator.ts](../packages/core/src/memory/curator.ts) processes new messages after 30 minutes idle, records a cursor, and summarizes the session. Its compare-and-set transaction prevents concurrent runs from applying the same extraction twice.

Non-sensitive candidates with confidence **≥ 0.8** become active; sensitive or lower-confidence candidates become pending. The extraction instruction flags health, immigration/visa status, finances, family/relationships, protected characteristics (religion, ethnicity, sexuality, disability, age), criminal history, and current employer conflict as sensitive. Stories and action status changes become Proposals instead of direct writes.

Exact normalized duplicates in the extraction and existing memory-add Proposals from the same session (regardless of status) are skipped. With embeddings, nearest active/pending memories are compared only in the same embedding model space; cosine similarity **≥ 0.85** triggers a fast-model `duplicate` / `update` / `new` decision. Without an embedding, lexeme overlap **≥ 0.6** triggers that comparison. Only an active match can be superseded; an `update` against pending is treated as a duplicate. Sensitivity and confidence routing still apply to replacements.

## Retrieval and embedding spaces

[retrieval.ts](../packages/core/src/memory/retrieval.ts) ranks active memories, stories, and earlier session summaries with Postgres full-text search and, when configured, vector distance. It takes up to 20 candidates per list and fuses their ranks with reciprocal rank fusion: `score = Σ 1 / (60 + rank)` where rank starts at one. Chat retrieves at most 12 combined results and excludes the current session’s summary. If query embedding fails, full-text results still stand.

Vectors are paired with `embedding_model` (summaries use `summary_embedding_model`); retrieval requires that model id to match the current embedding model. A model change cannot compare unrelated spaces. [embed.ts](../packages/core/src/memory/embed.ts) refreshes missing or stale model pairs through maintenance jobs. Embeddings are optional and may come from a separate provider config.

## Snapshot and profile version

[snapshot.ts](../packages/core/src/memory/snapshot.ts) builds a compact summary from profile and active memory. Domain changes bump `user_settings.profile_version`; maintenance finds a snapshot with an older version and schedules `snapshot.refresh`. Stored snapshots record `profile_version` and generation time. Until one exists, deterministic profile text is used. If no provider is usable or summary generation fails, refresh stores the deterministic fallback; the text is capped at 2,000 tokens. Recent conversation and rolling session summaries provide context separately.

## Export, deletion, and privacy

Settings exports a zip containing `pathwise-export.json` (format version 1) and original uploads under sanitized, unique `files/` names. It includes user settings, profile, memories and statuses/provenance, stories, paths, plans/actions, Proposals, conversations, workflows/check-ins, provider metadata, usage, snapshots, and document metadata. It omits auth sessions/accounts (tokens and password hashes), encrypted provider keys, embeddings, and full-text search columns. Missing uploads appear in `meta.missingFiles` instead of breaking the export.

Account deletion cascades through user-owned rows and auth state, removes the user's upload directory, cancels queued/retrying user jobs, and deletes their dead letters. Already active jobs can finish against missing rows and fail; Admin then shows a deleted user. The last admin must promote another admin before deletion. Copies in an operator’s backups, downloaded exports, or an external provider are outside the account deletion operation.

Logs and traces omit conversation/document content by default. Telemetry records timings and tokens while excluding prompts, replies, and tool payloads; provider/tool exception messages and stacks are sanitized in the telemetry copy too. `LOG_CONTENT=true` enables content recording for development. Configured LLM services receive the context necessary for requests; API keys remain server-side. See [self-hosting](self-hosting.md) for backups and tracing.
