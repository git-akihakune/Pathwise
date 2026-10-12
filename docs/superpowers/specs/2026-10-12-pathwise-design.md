# Pathwise — Product & System Design

- **Status:** Draft for review
- **Date:** 2026-10-12
- **Scope:** Whole-product vision and roadmap (v1–v4); detailed design for **v1** only. v2–v4 each get their own spec before implementation.
- **License:** AGPL-3.0

---

## 1. Overview

Pathwise is an open-source, self-hostable AI career coach. It talks with a person, learns what matters to them, helps them pick a realistic direction, turns that into a plan, and keeps them moving with weekly check-ins.

### 1.1 Purpose

Pathwise is simultaneously:

1. **An MVP**: genuinely usable by real people on their own instance.
2. **A showcase**: a readable, well-structured reference for a modern agentic application (skills + workflows + curated memory) with a polished UI.
3. **A personal/internal tool**: the authors and small groups use it for their own careers.

### 1.2 Positioning

Existing products are mostly *transactional tools*: Teal and Careerflow (job tracking + resume tailoring + LinkedIn tips), Rezi and Kickresume (resume editors + ATS scoring), Final Round AI (interview practice and a controversial live interview copilot), Google Interview Warmup (free, low-pressure practice with transcript insights), LinkedIn's coach (strong data, platform-locked). Users arrive, get an artifact, and leave.

Pathwise's differentiator is the **relationship over time**: a coach that remembers you, holds a plan, and checks in. Commodity features (resumes, mock interviews) exist to **feed the plan**, not as standalone tools.

### 1.3 Goals (v1)

- A new user can go from sign-up to a confirmed Profile, a chosen direction, and a Plan with first weekly actions in one sitting (target: ~30 minutes).
- Weekly check-ins start on time in the user's timezone, by email (when configured) and in-app, and update the Plan.
- The coach uses accurate remembered context and never fabricates facts about the user.
- From a fresh clone, `docker compose up` alone (no `.env`, no manual commands) builds, initializes, and serves a working instance. Every component runs as a container (§4.5).
- Works with Anthropic, OpenAI, and Google keys, and with OpenAI-compatible custom endpoints (verified against a local llama.cpp server).
- CI runs fully without any LLM API keys.

### 1.4 Non-goals (v1)

Application materials, interview prep, job search, offers/negotiation, voice, calendar OAuth, push notifications, messaging-app channels, region or career-stage packs, billing/monetization, a hosted SaaS offering, a live interview copilot (never; see §3.7).

---

## 2. Decision log

| # | Decision | Choice |
|---|---|---|
| D1 | Purpose | MVP + showcase + personal/internal use |
| D2 | Release order | v1 coach + direction + plan + check-ins → v2 materials + interview → v3 job search + agent mode → v4 offer + negotiation |
| D3 | Audience | Any profession, English-first, global. Region and career-stage specifics deferred to later "context packs" |
| D4 | Coach behaviour | Adapts to task: coach-style questioning for direction and values, direct advisor for tactical work. User-adjustable bluntness |
| D5 | Check-in channel (v1) | In-app + email with `.ics` calendar invite. Calendar OAuth, push, and messaging apps later |
| D6 | AI cost model | Bring your own key. No monetization in v1 |
| D7 | Distribution | Open-source, self-hostable. No vendor fallback key exists |
| D8 | Providers | Anthropic, OpenAI, Google, and OpenAI-compatible custom endpoints, via Vercel AI SDK |
| D9 | Tenancy | Multi-user per instance. Per-user keys, optional instance-wide key set by the instance admin |
| D10 | Agent architecture | One coach voice + skill registry + code-driven workflows + background memory curator |
| D11 | Writes by the agent | Always via user-approved Proposals in v1 (no auto-apply) |
| D12 | Sensitive memory | Special-category facts always require user confirmation |
| D13 | Stack | Next.js 16, React 19, Tailwind 4 + shadcn/ui, Postgres 17 + pgvector, Drizzle, Better Auth, pg-boss, Nodemailer + React Email |
| D14 | Missed check-ins | One nudge at +48h, marked missed at +7d, no further emails |
| D15 | Custom endpoint access | `CUSTOM_ENDPOINTS=admin_only` by default |
| D16 | License | AGPL-3.0 |
| D17 | Deployment | Zero-intervention `docker compose up`. All services containerized. Secrets auto-generated, migrations and taxonomy import automatic, all configuration optional |

---

## 3. Product

### 3.1 Core concepts (the shared spine)

Every feature, current and future, reads and writes these three things:

1. **Profile ("What I know about you")**: structured work history, education, and skills, plus values, constraints (location, visa, salary floor, caregiving), energizers, drains, aspirations, and preferences. Every item carries provenance and is user-editable.
2. **Story Bank**: achievements captured once in structured form (situation, task, action, result, metrics, skills demonstrated). In v2 a story becomes a resume bullet, a cover-letter paragraph, and a behavioural interview answer.
3. **Plan**: north-star goal → milestones (3–6 months) → weekly actions. Check-ins update it, and in v3 agent actions advance it.

### 3.2 Modes as one escalating coach

- **Advisor**: the chat.
- **Tool**: the chat opens structured surfaces inline (v1: path comparison, plan editor; v2: resume editor, mock interview).
- **Agent**: the coach proposes actions the user approves (v1: profile, story, and plan Proposals; v3: job matches, outreach drafts, pipeline updates).

Nothing is sent or submitted on the user's behalf without explicit approval.

### 3.3 Coach behaviour

- **Exploratory topics** (direction, values, "what do I want"): coach-style. The coach asks open questions, reflects back, and holds off on advice until the user has articulated their own view.
- **Tactical topics** (planning, and in later versions materials and scripts): advisor-style. The coach gives concrete recommendations and drafts.
- **Bluntness** setting from 1 (gentle) to 5 (blunt), default 3, injected into the persona prompt.
- Tone stays warm, honest, and non-judgmental. It never guilt-trips about missed actions.

### 3.4 Roadmap

| Version | Theme | Features |
|---|---|---|
| **v1** | The coach that knows you | Onboarding (CV/LinkedIn PDF/paste/conversation), Advisor chat with memory, Profile, Story Bank (seeded), Direction (career paths, skill gaps, bridge roles), Plan, weekly check-ins, BYOK providers, admin |
| **v2** | Materials & interview | Resume tailoring to a job description with a match score and truthfulness guard; cover letters; LinkedIn section rewrites; text mock interviews with feedback; Story Bank rehearsal; transcript insights |
| **v3** | Agent mode & market | Job matching (Adzuna, USAJobs, Remotive, Greenhouse/Lever/Ashby public boards), pipeline tracker, outreach and informational-interview drafts, approval inbox |
| **v4** | Offer & negotiation | Salary benchmarks with cited sources (BLS OES, H-1B LCA data, Adzuna histograms), negotiation scripts and role-play, offer comparison and total-compensation calculator |
| Later | Extensions | Calendar OAuth, web push, Telegram/Slack/WhatsApp channels, region packs, career-stage packs, voice |

### 3.5 v1 screens

| Screen | Purpose |
|---|---|
| **Today** | This week's actions, check-in status, a short coach note, pending Proposals and pending memory confirmations |
| **Coach** | One continuous conversation divided into sessions. A new session starts after a 6-hour gap or when the user starts a focused session with a topic |
| **Profile** | Experiences, education, skills, and memory items in profile categories, each with source, edit, and delete |
| **Stories** | Story Bank list and editor |
| **Plan** | North star, milestones, weekly actions; explored career paths with comparison view |
| **Settings** | Provider config + capability test, models per role, bluntness, timezone, check-in schedule, email on/off, data export, account deletion |
| **Admin** | Users, sign-up mode, instance-wide provider, SMTP status, job-queue health, dead-lettered jobs, per-user usage |

### 3.6 v1 journeys

1. **First run.** Sign up → connect a provider and run the capability test → upload CV / LinkedIn PDF, paste text, or skip → review extracted data → intake conversation (~10 min) → "Here's what I heard" snapshot → user confirms.
2. **Direction.** The coach explores, then generates **2–4 candidate paths**. Each path has: why it fits, a realistic route including bridge roles, skill gaps mapped to O\*NET/ESCO, time and cost, risks, and "what would have to be true". The user compares, combines, and chooses.
3. **Plan.** The coach drafts milestones and small, concrete weekly actions from the chosen path. The user edits directly. Later changes arrive as diff-style Proposals.
4. **Weekly check-in.** Email with a summary of the week and a "Start check-in" link → structured flow: wins, status of each action, blockers, energy (1–5), next week's actions proposed → summary saved to memory.
5. **Anytime chat.** The coach uses memory. Changes it wants to make appear as approval cards.

### 3.7 Guardrails

- **Not therapy.** When distress is detected, the coach responds supportively, slows down, and points to resources. Acute distress gets a fixed safety response with a configurable resource list (default: findahelpline.com).
- **No fabrication.** The coach never invents facts about the user. In v2, rewriting may rephrase but never add experience the user does not have.
- **Honest uncertainty.** Market-dependent claims (demand, salaries) are labelled as estimates until v3/v4 add cited data sources.
- **No live interview copilot.** Pathwise will not feed answers during real interviews.

---

## 4. Architecture

### 4.1 Topology

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

### 4.2 Repository layout

```
compose.yaml           The whole stack (§4.5); works with no .env
Dockerfile             Single multi-stage image for web, worker, and init
.env.example           Every optional override, documented
data/taxonomy/         Bundled, version-pinned O*NET + ESCO snapshot (§6.5)
apps/
  web/                 Next.js app (UI, route handlers, server actions, auth)
  worker/              Node process registering pg-boss job handlers; also
                       hosts the `init` and `pathwise` CLI entrypoints
packages/
  core/
    src/
      db/              Drizzle schema, migrations, client
      services/        Domain services (profile, memory, stories, plan, paths,
                       proposals, sessions, checkins, documents, settings, usage)
      agent/           Turn runtime, context assembler, skill registry
        skills/        core, direction, planning, intake, checkin
      workflows/       Workflow engine + onboarding, checkin definitions
      memory/          Curator, retrieval (vector + full-text), dedupe
      llm/             Provider factory, model roles, capability probe,
                       structured-output fallback
      jobs/            Job names, payload schemas, handlers
      mail/            Transport, React Email templates, .ics builder
      crypto/          AES-256-GCM helpers, key rotation
      taxonomy/        O*NET/ESCO import and query
evals/                 Persona × scenario suite, rubric, judge, results
docs/                  Architecture, adding a skill, adding a provider, memory model
```

`packages/core` contains all domain and agent logic and must not import Next.js. The web app and the worker are thin adapters around it.

### 4.3 Stack

| Concern | Choice |
|---|---|
| Runtime | Node 24, pnpm workspaces, TypeScript strict |
| Containers | Docker Compose v2; `pgvector/pgvector:pg17`; app image on `node:24-slim`, Next.js `standalone` output, non-root user |
| Web | Next.js 16 App Router, React 19 |
| UI | Tailwind CSS 4, shadcn/ui |
| LLM | Vercel AI SDK 7 (`ai`, `@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/google`, `@ai-sdk/openai-compatible`), `useChat` on the client |
| Validation | Zod 4 |
| Database | Postgres 17 + pgvector, Drizzle ORM + drizzle-kit migrations |
| Jobs | pg-boss (queue + cron in Postgres) |
| Auth | Better Auth (email + password, admin plugin) |
| Email | Nodemailer (SMTP), React Email templates, `.ics` generation |
| Documents | unpdf (PDF text), mammoth (DOCX) |
| Logging | pino, structured, content-free by default |
| Tests | Vitest, Playwright |

### 4.4 LLM provider layer

**Provider kinds:** `anthropic`, `openai`, `google`, `openai_compatible` (base URL + optional key, covering llama.cpp, Ollama, vLLM, LM Studio, LiteLLM, OpenRouter).

**Resolution order for a user:** the user's own provider config, then the instance-wide config (if the admin set one), otherwise none. With no provider, coach features show a setup prompt; manual editing still works.

**Model roles:**

| Role | Used for | Required |
|---|---|---|
| `main` | Coach chat, career-path generation, plan drafting | Yes |
| `fast` | Intent and distress classification, extraction, summaries, curator, step-completion checks | Yes (may equal `main`) |
| `embedding` | Memory/story/summary embeddings | No; retrieval falls back to full-text only |

The embedding model may use a different provider config from chat (for example a local embedding server alongside a cloud chat model).

**Capability probe**, run on save and on demand. Results are stored in `provider_configs.capabilities`:

| Check | Method |
|---|---|
| `basic` | Short completion returns text |
| `streaming` | Streamed completion yields more than one chunk |
| `tools` | Model calls a trivial tool with valid arguments |
| `jsonSchema` | Native structured output returns schema-valid JSON |
| `pdfInput` | Static table for known providers; `false` for custom endpoints |
| `contextWindow` | Static table for known models; user-entered for custom endpoints (default 8,192) |

**Status:** `full` (all checks pass), `degraded` (`basic` and `streaming` pass, others fail), `unsupported` (`basic` or `streaming` fails; the config cannot be activated).

**Fallbacks:**

- No `jsonSchema`: prompted JSON with the schema in the prompt → Zod validation → one repair retry including the validation errors.
- No `tools`: chat runs without tools. Retrieved context is still injected, and Proposals come only from the curator after the session.
- No `pdfInput`: text extraction only. Scanned PDFs prompt the user to paste text.

### 4.5 Deployment

**The contract:** from a fresh clone, on any host with Docker Compose v2:

1. `docker compose up` builds the image, initializes the database, and serves the app at `http://localhost:3000`.
2. No `.env` file, no copied config, no manual command.
3. The first person to register becomes admin and configures an LLM provider in the UI.

Every component runs as a container. Nothing is installed on the host besides Docker.

**Services (`compose.yaml`):**

| Service | Image | Role | Lifecycle |
|---|---|---|---|
| `postgres` | `pgvector/pgvector:pg17` | Database + pg-boss queue | Long-running; healthcheck `pg_isready`; volume `pathwise-db`; port not published |
| `init` | `pathwise` (built from `Dockerfile`), command `init` | 1. generate missing secrets; 2. run Drizzle migrations; 3. import the bundled taxonomy if its version differs from the DB; 4. ensure the `instance_settings` row exists; 5. seed the demo persona if `SEED_DEMO=true` | One-shot and idempotent. Waits for `postgres` healthy; exits 0 on success |
| `web` | `pathwise`, command `web` | Next.js standalone server | Waits for `init` to complete successfully; healthcheck `GET /api/health` (DB reachable); publishes `${PATHWISE_PORT:-3000}` |
| `worker` | `pathwise`, command `worker` | pg-boss consumers and cron | Waits for `init` to complete successfully; healthcheck via heartbeat file |

- All long-running services use `restart: unless-stopped`.
- Compose files declare `build:`, so a clone works without any registry. Published images (GHCR) may be added later as `image:` alongside `build:`.

**One image, three entrypoints.**

- A multi-stage `Dockerfile` builds the pnpm workspace once. It produces the Next.js `standalone` output and a bundled Node entry for worker, init, and CLI.
- The entrypoint dispatches on its first argument: `web | worker | init | pathwise <cli-args>`.
- It runs as a non-root user.

**Secrets with no setup.**

- `APP_ENCRYPTION_KEY` and `BETTER_AUTH_SECRET` are read from the environment if set. Otherwise they are read from `/var/lib/pathwise/secrets/<name>` (volume `pathwise-secrets`).
- `init` generates any missing secret on first boot (32 random bytes, base64, file mode 0600).
- **Back up `pathwise-secrets` together with `pathwise-db`.** Losing it makes stored API keys undecryptable. Users would have to re-enter keys; all other data is unaffected.

**Configuration is entirely optional.** Compose automatically reads a `.env` file next to `compose.yaml` if one exists, and `.env.example` documents every variable:

| Variable | Default | Notes |
|---|---|---|
| `APP_URL` | `http://localhost:3000` | Public URL, used in emails and auth callbacks |
| `PATHWISE_PORT` | `3000` | Host port for `web` |
| `POSTGRES_PASSWORD` | `pathwise` | Postgres is only reachable on the internal compose network |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | unset | Unset disables email (§8) |
| `CUSTOM_ENDPOINTS` | `admin_only` | §10 |
| `ALLOW_PRIVATE_ENDPOINTS` | `false` | §10 |
| `SEED_DEMO` | `false` | Load the demo persona during `init` |
| `LOG_CONTENT` | `false` | Development only |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | unset | Optional tracing |

**LLMs running on the host.**

- `web` and `worker` declare `extra_hosts: ["host.docker.internal:host-gateway"]`.
- This lets a llama.cpp (or Ollama, etc.) server on the host be reached at `http://host.docker.internal:<port>/v1` on Linux, macOS, and Windows alike.

**Operations.**

| Task | Command |
|---|---|
| Upgrade | `git pull && docker compose up -d --build`. `init` applies new migrations before `web` and `worker` restart |
| Logs | `docker compose logs -f web worker` |
| Admin CLI | `docker compose exec worker pathwise <command>`, e.g. `admin reset-password <email>`, `admin rotate-encryption-key`, `seed demo` |
| Backup | `pg_dump` via `docker compose exec postgres`, plus copies of the `pathwise-files` and `pathwise-secrets` volumes (documented in the self-hosting guide) |

**Development** happens in the devcontainer, which includes Docker via the `docker-in-docker` feature so it can run the stack and the integration-test database. The implementation plan fixes the exact developer workflow (hot reload, which services run where). The production `docker compose up` path must not depend on it.

---

## 5. Agent design

### 5.1 Turn pipeline (free chat)

1. **Persist** the user message to the current session (create a session if none is open or the gap exceeds 6 hours).
2. **Classify.** One `fast`-model structured call returns `{ skills: SkillId[], distress: "none" | "elevated" | "acute" }`. This is skipped inside workflows, where the workflow step defines the skills.
3. **Select skills** = `core` ∪ classifier result ∪ skills used in the previous 3 turns (stickiness) ∪ skills implied by the screen the chat was opened from.
4. **Assemble context** (§5.2).
5. **`streamText`** with the main model and the union of selected skills' tools.
6. **Stream** UI message parts to the client. Tool calls render as cards ("Looked up: Registered Nurse (O\*NET 29-1141.00)"), and Proposals render as approval cards.
7. **On finish:** persist the assistant message with parts and token usage, record `llm_usage`, and (re)schedule `session.curate` for 30 minutes later.

If `distress` is `acute`, the turn uses the fixed safety response template instead of normal skill handling. If `elevated`, the persona prompt adds a "slow down, acknowledge, no task pressure" instruction.

### 5.2 Context assembly

Total input budget = `min(0.6 × contextWindow, 32,000)` tokens for `main`. Sections in priority order with caps:

| Priority | Section | Cap |
|---|---|---|
| 1 | Core persona, guardrails, bluntness | 1,500 |
| 2 | User snapshot (compact Profile summary, regenerated when the Profile changes) | 2,000 |
| 3 | Active Plan summary (north star, current milestone, this week's actions) | 1,000 |
| 4 | Selected skills' prompt fragments | 2,000 |
| 5 | Retrieved memories (hybrid search, up to 12 items) | 2,000 |
| 6 | Session rolling summary | 1,000 |
| 7 | Recent messages | Remainder |

When the budget is short, sections are trimmed from priority 7 upward (oldest messages first, then fewer memories, and so on). Priorities 1–3 are never dropped. Document content and other untrusted text is wrapped in clearly delimited data blocks.

**Hybrid retrieval:** pgvector cosine similarity (if embeddings exist) and Postgres full-text rank are combined by reciprocal rank fusion over `memory_items` (status `active`), `stories`, and `sessions.summary`.

### 5.3 Skills

```ts
interface Skill {
  id: SkillId;
  description: string;                 // used by the classifier
  promptFragment(ctx): string;         // behaviour instructions for this skill
  tools(ctx): Record<string, Tool>;    // AI SDK tools
  contextProviders?: ContextProvider[]; // extra context sections, budgeted
}
```

**v1 skills and tools:**

| Skill | Tools |
|---|---|
| `core` | `searchMemory`, `proposeMemory`, `proposeProfileUpdate`, `proposeStory` |
| `direction` | `searchOccupations`, `getOccupation` (skills, tasks, related occupations), `generateCareerPaths` (sub-task), `proposeSavePath` |
| `planning` | `getPlan`, `proposePlan` (create from a path), `proposePlanChange` (milestones/actions diff) |
| `intake` | `getIntakeCoverage`, plus `core` tools (workflow-only) |
| `checkin` | `getWeekSummary`, `proposeActionStatusUpdates`, `proposePlanChange` (workflow-only) |

**`generateCareerPaths` sub-task:**

1. Retrieve candidate occupations from the taxonomy using the user's skills, experiences, and stated interests (full-text plus optional embeddings).
2. Compute deterministic skill gaps: each candidate occupation's important skills minus the user's taxonomy-matched skills.
3. One `main`-model structured call produces 2–4 paths with: title, target occupation codes, fit rationale, route (ordered steps including bridge roles), skill gaps (taking the deterministic list as input), feasibility (time, cost, risks, what must be true).

Paths are returned to the conversation and can be saved via `proposeSavePath`.

### 5.4 Proposals

Write tools never mutate data. They insert a `proposals` row and return its id, and the UI renders an approval card.

- **Kinds (v1):** `profile_update` (experience/education/skill create, update, delete), `memory_add`, `memory_update`, `story_add`, `story_update`, `path_save`, `plan_create`, `plan_change`, `action_status_update`.
- **Actions:** approve, edit-then-approve, reject. Approval calls the matching domain service in a transaction.
- **Staleness:** targets carry an integer `version`. A proposal stores the version it was based on. On approval, a mismatch marks the proposal `conflicted`, and the card offers "Regenerate against current data".
- Pending Proposals also appear on the Today screen.

### 5.5 Workflows

A workflow is a code-defined state machine persisted in `workflow_runs`.

```ts
type Step =
  | { kind: "conversational"; id; skills: SkillId[]; goal: string;
      completion: ZodSchema }  // fast-model check after each turn
  | { kind: "compute"; id; run(ctx): Promise<StepResult> };
```

- A conversational step runs the normal turn pipeline with the step's skills and goal injected. After each assistant turn, a `fast`-model structured check decides whether the goal is met. The user can always press "Skip" / "Move on".
- Compute steps that fail after retries leave the run in `needs_attention` with **Retry** and **Do it manually** options.
- Runs are resumable from the last completed step after a restart or navigation.

**Onboarding workflow:**

1. `provider_check` (compute): ensure an active provider with status ≠ `unsupported`.
2. `ingest` (compute): wait for `document.parse` if a document was uploaded. Skippable.
3. `review_extraction` (UI step): user reviews extracted experiences, education, and skills and edits or accepts them. The result is applied directly (this review is the approval).
4. `intake` (conversational, skill `intake`): goal is coverage of values, constraints, energizers, drains, aspirations, and current situation. `getIntakeCoverage` tracks which topics are covered, and memories are proposed inline.
5. `snapshot` (compute): generate the "Here's what I heard" summary.
6. `confirm` (UI step): user confirms or corrects. Then the run completes and the user lands on Coach with the direction skill primed.

**Check-in workflow:**

1. `prepare` (compute, run by `checkin.prepare`): week summary from actions, sessions, and Proposals.
2. `wins` (conversational).
3. `action_review` (conversational, `checkin`): walk through this week's actions and propose status updates.
4. `blockers` (conversational).
5. `energy` (UI step): 1–5 rating, optional note.
6. `replan` (conversational, `checkin` + `planning`): propose next week's actions. Energy 1–2 caps the proposal at 2 actions.
7. `summarize` (compute): persist the check-in summary as a session summary and memory items.

### 5.6 Memory curator

Triggered by `session.curate` 30 minutes after the last message in a session (the job is keyed per session, so each new message resets the timer).

1. Load session messages since the last curation watermark.
2. **Extract** with `fast` (structured): candidate memory items (category, content, confidence 0–1, sensitivity flag), candidate stories, and plan signals (for example "user says they finished the course").
3. **Dedupe** each candidate against existing items (vector similarity ≥ 0.85, or full-text match when no embeddings). On a near match, a `fast` call decides: `duplicate` (drop), `update` (supersede the old item), or `new`.
4. **Route:**
   - Non-sensitive and confidence ≥ 0.8: insert as `active`.
   - Sensitive (health, family, finances, immigration/visa, religion, sexual orientation, ethnicity, political views) or confidence < 0.8: insert as `pending`. These show in the "New things I learned" inbox on Today.
   - Stories and plan signals become Proposals.
5. Advance the watermark and update the session summary.

Facts the user states explicitly via an approved Proposal are always `active`.

---

## 6. Data model

All user-owned tables have `user_id` (FK, `ON DELETE CASCADE`), `created_at`, and `updated_at`. All access is through `core` services that take a `userId`. Rows that can be targeted by Proposals carry an integer `version`.

### 6.1 Identity & configuration

- **Better Auth tables:** `user` (+ `role`: `admin` | `user`), `session`, `account`, `verification`.
- **`provider_configs`:** `id`, `user_id` (nullable = instance-wide), `kind`, `label`, `base_url`, `encrypted_key`, `models` (jsonb: `main`, `fast`, `embedding?`, `embeddingProviderConfigId?`), `context_window`, `capabilities` (jsonb), `status`, `last_tested_at`.
- **`user_settings`:** `user_id` (PK), `provider_config_id`, `bluntness` (1–5, default 3), `timezone` (IANA), `checkin_enabled` (default true), `checkin_day` (default Sunday), `checkin_time` (default 18:00), `email_enabled`.
- **`instance_settings`:** singleton. `signup_mode` (`open` | `invite_only` | `closed`), `instance_provider_config_id`, safety resource list.
- **`invites`:** `email`, `token_hash`, `expires_at`, `used_at`.

### 6.2 What the coach knows

- **`documents`:** `kind` (`cv` | `linkedin` | `other`), `filename`, `mime`, `storage_path`, `extracted_text`, `status` (`pending` | `parsed` | `failed`), `error`.
- **`experiences`:** `title`, `organization`, `start_date`, `end_date`, `description`, `highlights` (jsonb), `source_type`, `source_id`.
- **`education`:** `institution`, `qualification`, `field`, `start_date`, `end_date`, `source_type`, `source_id`.
- **`skills`:** `name`, `level` (`basic` | `working` | `strong` | `expert`, nullable), `taxonomy_skill_id` (nullable), `evidence`, `source_type`, `source_id`.
- **`memory_items`:** `category` (`value` | `constraint` | `aspiration` | `energizer` | `drain` | `preference` | `fact` | `event` | `observation`), `content`, `source_type` (`cv` | `message` | `checkin` | `manual`), `source_id`, `confidence`, `sensitive` (bool), `status` (`active` | `pending` | `rejected` | `superseded`), `supersedes_id`, `embedding` (vector, nullable), full-text `tsvector`.
- **`stories`:** `title`, `situation`, `task`, `action`, `result`, `metrics`, `skills` (text[]), `source_type`, `source_id`, `embedding`, `tsvector`.
- **`user_snapshot`:** `user_id` (PK), `content`, `generated_at`, `profile_version`.

The Profile screen shows experiences, education, and skills, plus memory items in categories `value`, `constraint`, `aspiration`, `energizer`, `drain`, and `preference`.

### 6.3 Direction & plan

- **`career_paths`:** `title`, `occupation_codes` (text[]), `rationale`, `route` (jsonb), `skill_gaps` (jsonb), `feasibility` (jsonb), `status` (`explored` | `chosen` | `dismissed`).
- **`plans`:** `north_star`, `career_path_id`, `status` (`active` | `archived`). At most one active plan per user (partial unique index).
- **`milestones`:** `plan_id`, `title`, `description`, `target_date`, `position`, `status` (`open` | `done` | `dropped`).
- **`actions`:** `plan_id`, `milestone_id` (nullable), `title`, `notes`, `week_of` (date, Monday of the week in the user's timezone), `status` (`todo` | `done` | `skipped`), `done_at`.

### 6.4 Conversation & agent state

- **`sessions`:** `started_at`, `last_message_at`, `ended_at`, `topic`, `summary`, `summary_embedding`, `curated_through_message_id`, `workflow_run_id`.
- **`messages`:** `session_id`, `role`, `parts` (jsonb, AI SDK `UIMessage` parts), `status` (`complete` | `interrupted`), `input_tokens`, `output_tokens`.
- **`proposals`:** `session_id`, `message_id`, `kind`, `payload` (jsonb), `target_id`, `target_version`, `status` (`pending` | `approved` | `rejected` | `conflicted`), `resolved_at`.
- **`workflow_runs`:** `type` (`onboarding` | `checkin`), `step_id`, `state` (jsonb), `status` (`active` | `needs_attention` | `completed` | `abandoned`).
- **`checkins`:** `week_of`, `due_at`, `workflow_run_id`, `energy`, `summary`, `status` (`scheduled` | `sent` | `nudged` | `completed` | `missed`).
- **`llm_usage`:** `provider_config_id`, `model`, `role`, `purpose`, `input_tokens`, `output_tokens`, `created_at`.

### 6.5 Reference data (shared, read-only)

- **`occupations`:** `source` (`onet` | `esco`), `code`, `title`, `description`, `alt_titles` (text[]), `tsvector`, `embedding` (nullable).
- **`taxonomy_skills`:** `source`, `code`, `name`, `description`, `tsvector`.
- **`occupation_skills`:** `occupation_id`, `taxonomy_skill_id`, `importance` (normalized 0–1), `level` (nullable).
- **`occupation_relations`:** `from_id`, `to_id`, `kind` (`related` | `crosswalk`).

**Source data:**

- The official O\*NET database (CC BY 4.0) and the ESCO CSV export (redistribution allowed with attribution).
- The ESCO–O\*NET crosswalk populates `crosswalk` relations where available.

**Getting it into the database:**

1. A maintainer script, `pnpm taxonomy:build`, downloads the pinned versions and reduces them to the fields above (English only).
2. It writes a compact gzipped JSONL snapshot plus a `manifest.json` (source versions, checksum) to `data/taxonomy/`, which is committed to the repo.
3. `init` imports the snapshot into Postgres whenever the manifest version differs from the version recorded in the DB.

No network access is needed at boot. Taxonomy embeddings, if wanted, are computed later by the worker once an embedding model is configured.

### 6.6 Data rights

- **Export:** a JSON bundle of every user-owned row plus original uploaded files, delivered as a zip.
- **Delete account:** cascades through every user-owned table and deletes stored files. Pending jobs for the user are cancelled.

---

## 7. Background jobs

All jobs are defined in `packages/core/jobs` with Zod payload schemas and run by `apps/worker`. Default retry: 3 attempts with exponential backoff, then the dead-letter queue (visible in Admin).

| Job | Trigger | Behaviour |
|---|---|---|
| `document.parse` | Upload | Extract text (unpdf/mammoth), or pass the raw PDF if `pdfInput`. Structured extraction into experiences, education, skills, and candidate memory items and stories for onboarding review. Text-free PDF without `pdfInput` → `failed` with a "paste text" prompt |
| `session.curate` | 30 min after last message, keyed per session | Memory curator (§5.6) |
| `session.summarize` | Session recent messages exceed 60% of the messages budget | Update rolling summary, advance the window |
| `memory.embed` | Insert or update of memory items, stories, session summaries | Embed if an embedding model is configured; otherwise no-op |
| `snapshot.refresh` | Profile or memory `active` set changes (debounced 1 min) | Regenerate `user_snapshot` |
| `checkin.dispatch` | Cron every 15 min | Find users with `checkin_enabled` whose next local check-in time has passed and who have no `checkins` row for that week → create a `scheduled` row → enqueue `checkin.prepare` |
| `checkin.prepare` | From dispatch | Run workflow step `prepare` → send email if SMTP and `email_enabled` → status `sent` → enqueue `checkin.followup` at +48h |
| `checkin.followup` | +48h | If not completed: one nudge (email/in-app) → `nudged` → enqueue a final check at +7d from due, which marks `missed` if still incomplete |

**Provider-auth failures** (401/403) in any job mark the user's provider config `status = degraded` with an `auth_failed` flag, and further LLM jobs for that user are skipped (not retried) until the config is re-tested.

---

## 8. Email & calendar

- **Transport:** Nodemailer SMTP configured via the optional `SMTP_*` variables (§4.5). If they are not set, email features are disabled instance-wide and Admin shows a banner.
- **Templates (React Email):** weekly check-in, nudge, invite, password reset, email verification.
- **Check-in email:** week summary (done/remaining actions, one encouraging line), a "Start check-in" link to the app (normal login required; no magic-login tokens).
- **Calendar invite:** when the check-in schedule is set or changed, an email with a `.ics` attachment (`METHOD:REQUEST`, weekly `RRULE`, stable per-user `UID` so updates replace the event; `METHOD:CANCEL` when disabled).
- **Without SMTP:** email verification and password reset are unavailable. The admin resets passwords via CLI (`docker compose exec worker pathwise admin reset-password <email>`).

---

## 9. Error handling

| Situation | Behaviour |
|---|---|
| Provider 401/403 | Banner "Your API key was rejected" → Settings. Jobs pause for that user (§7) |
| 429 / 5xx | Jobs: backoff retries. Chat: inline error with Retry |
| Context length exceeded | Retry once with a 30% smaller budget. If it fails again, show an error suggesting starting a new session |
| Structured output invalid | One repair retry with validation errors. Then workflow → `needs_attention`; chat tool → tool error surfaced to the model once, then to the user |
| Stream interrupted | Persist partial assistant message as `interrupted` with Regenerate |
| Scanned PDF, no `pdfInput` | Ask user to paste text |
| Stale Proposal | `conflicted` card with "Regenerate against current data" |
| No provider configured | Manual editing works. Coach features show a setup prompt |
| No SMTP | In-app check-ins only. Admin banner |
| Capability probe fails | Config saved but cannot be activated; per-check results shown |

---

## 10. Security & privacy

- **Auth:** Better Auth with secure, HTTP-only cookies; rate limits on sign-in and sign-up. The first registered user becomes admin. After that, `signup_mode` defaults to `invite_only`.
- **Secrets:** API keys are encrypted with AES-256-GCM using `APP_ENCRYPTION_KEY` (32 bytes, base64; auto-generated by `init` unless provided, §4.5), decrypted only in server code, never returned to the client (only the last 4 characters are shown), and never logged. `pathwise admin rotate-encryption-key` re-encrypts all keys.
- **Custom endpoints:** `CUSTOM_ENDPOINTS=admin_only | all | off` (default `admin_only`). Admins may target private/loopback addresses (needed for local llama.cpp). When non-admins are allowed (`all`), base URLs resolving to private, loopback, or link-local ranges are rejected unless `ALLOW_PRIVATE_ENDPOINTS=true`.
- **Prompt injection:** documents and pasted text are placed in delimited data blocks with an instruction to treat them as data. All writes require human approval. v1 has no outbound tools besides LLM calls.
- **Uploads:** 10 MB max, MIME type sniffed from content (PDF, DOCX, TXT only), stored outside the web root under random names.
- **Logging:** pino structured logs. No message content, document text, or keys unless `LOG_CONTENT=true` (development only).
- **Authorization:** every service function takes `userId` and scopes queries by it. Admin-only operations are checked server-side via `role`.

---

## 11. Testing & evals

| Layer | Tooling | Scope |
|---|---|---|
| Unit | Vitest | Context budgeting and trimming, skill selection, workflow transitions, Proposal application and staleness, crypto, check-in due-time computation across timezones and DST, retrieval fusion |
| Integration | Vitest + Postgres 17/pgvector in Docker; AI SDK mock language models | Services against a real DB; turn pipeline with scripted model outputs; curator routing; job handlers |
| E2E | Playwright, `LLM_MODE=mock` | Onboarding, chat → approval card → applied, plan editing, check-in flow, settings/provider test (mock), data export |
| Compose smoke (CI) | `docker compose up -d --build --wait` on a clean checkout with no `.env` | Proves the §4.5 contract: `init` exits 0, `/api/health` returns 200, the sign-up page renders, and a second `up` is idempotent (no re-seed, no new secrets) |
| Local smoke | `pnpm smoke:local` | Capability probe + one onboarding pass against `LOCAL_LLM_BASE_URL` (llama.cpp). Degraded status is acceptable |
| Evals | `evals/`, real key, run manually | Personas (career changer, new grad, burned-out senior, returning parent, tradesperson) × scenarios. LLM-judge rubric: no fabrication, coach-style questioning in exploratory topics, well-formed Proposals, appropriate distress handling, grounded skill gaps. Results stored as JSON for regression comparison |

`LLM_MODE=mock` swaps the provider factory for deterministic mock models with scripted fixtures, so CI needs no keys.

---

## 12. Open-source readiness & developer experience

- README with the architecture diagram, a short demo GIF, and a two-step quick start: `docker compose up`, then open `http://localhost:3000` and register (that account becomes admin).
- The taxonomy imports automatically (§6.5). The demo persona (Profile, Stories, chosen path, Plan, chat history) loads with `SEED_DEMO=true` or `docker compose exec worker pathwise seed demo`.
- `docs/`: architecture, adding a skill, adding a provider, memory model, self-hosting guide (SMTP, local LLMs, backups).
- `LICENSE` (AGPL-3.0), `CONTRIBUTING.md`, attribution notices for O\*NET and ESCO.
- Optional OpenTelemetry via the AI SDK's telemetry hooks, off by default (`OTEL_EXPORTER_OTLP_ENDPOINT`).

---

## 13. Extension points (designed for, not built in v1)

- **Channels:** a `CheckinChannel` interface (`email` and `in_app` in v1) to add calendar OAuth, web push, Telegram, Slack, or WhatsApp.
- **Context packs:** region packs (CV conventions, job boards, visa notes) and career-stage packs (new grad, career change, leadership) as skill fragments plus data, selectable in settings.
- **Data sources:** a `JobSource` and `SalarySource` interface for v3/v4, with citations carried through to the UI.
- **Skills:** v2–v4 features arrive as new skills (`materials`, `interview`, `jobs`, `offer`) and workflows; the core runtime is unchanged.

---

## 14. Risks & open questions

- **Taxonomy bias:** O\*NET is US-centric and ESCO EU-centric; occupations elsewhere map imperfectly. Mitigation: the coach treats taxonomy matches as reference points, not verdicts, and region packs can add local taxonomies later.
- **Small local models:** a 4B model will likely be `degraded`. That is acceptable for smoke testing; product quality is judged on frontier models.
- **Per-message classifier cost:** one extra `fast` call per chat message. If it proves costly, replace it with heuristics plus classification only on topic shifts.
- **Bundled taxonomy size:** the committed snapshot must stay small (target: under 20 MB gzipped). If it grows beyond that, move it to a GitHub Release asset fetched during `docker build`, which keeps runtime boot offline.
- **Self-hosted email deliverability:** depends on the operator's SMTP. The docs recommend a transactional provider.
- **Intake length:** the ~10-minute intake may feel long; the skip and "finish later" paths must work well. To be validated in user testing.
