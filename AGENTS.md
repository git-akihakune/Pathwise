# AGENTS.md

## Project

Pathwise is an open-source (AGPL-3.0), self-hostable AI career coach. The approved design is in [docs/superpowers/specs/2026-10-12-pathwise-design.md](docs/superpowers/specs/2026-10-12-pathwise-design.md). Treat it as the source of truth and read the relevant section before changing behaviour. Only v1 is designed in detail; v2–v4 each need their own spec first.

## Dev Environment
`nix` is installed in the devcontainer. You can install and run any tool as needed using nix.

## Commands

- pnpm workspaces, Node 24 (devcontainer provides Node and Nix)
- `pnpm dev`: dev database + init + web + worker
- `pnpm lint`, `pnpm typecheck`
- `pnpm test` (unit) and `pnpm test:int` (Testcontainers; needs Docker)
- A single test: `pnpm test <path> -t "<name>"` / `pnpm test:int <path> -t "<name>"`
- `pnpm e2e`: Playwright against a fresh compose stack on port 3100
- `bash scripts/compose-smoke.sh`: boots the compose stack from scratch and checks it (prints `SMOKE OK`)
- `pnpm --filter @pathwise/core db:generate` after schema changes
- `docker compose up` brings up the whole stack from a fresh clone with no `.env` and no manual steps: `postgres`, a one-shot `init` (secrets, migrations, taxonomy import), `web` and `worker`. All of them are containers built from one `Dockerfile` (spec §4.5)
- Admin CLI: `docker compose exec worker pathwise <command>` (e.g. `admin reset-password <email>`)

## Architecture rules

- **`packages/core` holds all domain, agent, and database logic and must not import Next.js.** `apps/web` (Next.js 16) and `apps/worker` (pg-boss consumers) are thin adapters over it.
- **User data is accessed only through `core` services that take a `userId`.** Never query tables from UI code.
- **The agent never writes user data directly.** Write tools create `proposals` rows that the user approves. Proposal targets carry a `version` column for staleness checks.
- **Agent shape:** one coach persona, plus skills from a registry selected per turn, plus code-defined workflows (onboarding, check-in) stored in `workflow_runs`, plus a background memory curator. Don't add specialist sub-agent personas.
- **LLM access goes through the provider layer** (Vercel AI SDK) using model roles `main`, `fast`, and an optional `embedding` model. Code must handle models without tool calling or JSON-schema support via the documented fallbacks (spec §4.4).
- **Bring your own key, with no vendor fallback key.** API keys are AES-256-GCM encrypted with `APP_ENCRYPTION_KEY` and never sent to the client.
- **`docker compose up` must keep working with zero intervention.** Every new setting needs a safe default (an optional env var listed in `.env.example`). Every new setup step belongs in `init`, and it must be idempotent. No dependencies on managed services such as Vercel Cron or KV, and no network fetches at boot. The CI compose smoke test enforces this.
- **CI must pass without any LLM API keys.** Use AI SDK mock models.

## Conventions

- Work on `dev`; open PRs against `main`.
- Conventional commit prefixes (`feat:`, `fix:`, `docs:`, `chore:`).
- Specs go in `docs/superpowers/specs/`, implementation plans in `docs/superpowers/plans/`.

## General guidelines

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.