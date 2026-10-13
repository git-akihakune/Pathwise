# Contributing

Use the devcontainer for Node 24, pnpm, Nix, and Docker (including integration tests). `packages/core` owns domain and agent logic; web and worker are adapters. Read [AGENTS.md](AGENTS.md) and the relevant section of the [approved design](docs/superpowers/specs/2026-10-12-pathwise-design.md) before changing behavior. See [architecture](docs/architecture.md), [skills](docs/adding-a-skill.md), and [providers](docs/adding-a-provider.md).

## Development commands

```bash
pnpm install
pnpm dev            # dev database + init + web + worker
pnpm dev:db         # dev Postgres only
pnpm dev:init       # initialize dev database/secrets/taxonomy
pnpm dev:web        # Next.js hot reload
pnpm dev:worker     # worker hot reload
pnpm lint
pnpm format         # apply Biome formatting/check fixes
pnpm typecheck
pnpm build
pnpm test           # unit tests
pnpm test:int       # Testcontainers integration tests; needs Docker
pnpm test <path> -t "<name>"
pnpm test:int <path> -t "<name>"
pnpm e2e            # fresh compose stack on port 3100
bash scripts/compose-smoke.sh
pnpm --filter @pathwise/core db:generate
pnpm taxonomy:build # build pinned taxonomy; see architecture guide for optional ESCO
pnpm taxonomy:fixture # regenerate tiny test taxonomy
```

`pnpm dev` starts the database and init before running web and worker together. Integration tests and compose checks require Docker; local development uses `dev.env`. New settings need safe defaults in [.env.example](.env.example), and new setup work belongs in idempotent init. Avoid managed-service dependencies and network fetches at boot.

## Test layers

| Layer | What it verifies |
|---|---|
| Unit (Vitest) | Pure budgeting, selection, workflow transitions, schemas, crypto, timezones/DST, rank fusion |
| Integration (Vitest/Testcontainers) | Core services and agent/job paths on real Postgres 17/pgvector with scripted AI SDK models |
| E2E (Playwright, mock) | Onboarding, chat/approval, plans, check-ins, settings, export/deletion, Admin |
| Compose smoke (CI) | A fresh checkout starts without `.env`; health/sign-up work; second init is idempotent |
| Local smoke (manual) | Real compatible-model capability probe and onboarding |
| Evals (manual) | Persona/scenario coaching simulations and judge rubric; saved JSON comparison |

CI has no LLM keys. New model behavior needs deterministic mock fixtures under `packages/core/src/llm/mock/fixtures`, including classifier and E2E trigger phrases. Write a reproducing test first for a behavior change, then implement and verify it. Single-worker unit runs (`pnpm test --maxWorkers=1`) avoid contention on slower devcontainers.

## Manual local smoke and evals

Start a local OpenAI-compatible server, then run:

```bash
LOCAL_LLM_BASE_URL=http://localhost:8080/v1 LOCAL_LLM_MODEL=local-model pnpm smoke:local
```

`LOCAL_LLM_MODEL` defaults to `local-model`; `LOCAL_LLM_API_KEY` is optional. The harness needs Docker for its temporary database, but no cloud key. Degraded capability status is acceptable; see [self-hosting](docs/self-hosting.md) for llama.cpp and host gateway setup.

Live evals need Docker plus developer-only provider settings: `EVAL_PROVIDER_KIND` (`anthropic`, `openai`, `google`, `openai_compatible`), `EVAL_MAIN_MODEL`, `EVAL_FAST_MODEL`, `EVAL_JUDGE_MODEL`, and `EVAL_API_KEY` for first-party providers. A compatible server requires `EVAL_BASE_URL`; its key is optional. Main and fast are saved/tested before use, and the custom-endpoint judge uses the admin harness policy. The temporary database and secrets are cleaned up; [evals/src/live.ts](evals/src/live.ts) loads live dependencies only in run mode.

```bash
pnpm evals
pnpm evals --persona career-changer --scenario first-direction
pnpm evals --compare evals/results/base.json
pnpm evals compare evals/results/base.json evals/results/head.json
```

Use ids listed in [personas.ts](evals/src/personas.ts) and [scenarios.ts](evals/src/scenarios.ts); invalid ids print choices. Results are JSON under `evals/results/` (ignored), with transcripts, Proposals, scores, errors, and summary. Treat them as private conversational data even though keys are redacted. Runs/compares exit nonzero on errors or detected regressions. Offline `compare` uses saved JSON and pure comparison code; it needs neither Docker nor provider env vars. `LOCAL_LLM_*` and `EVAL_*` belong to manual developer invocations, not `.env.example` or compose, and neither harness runs in CI.

## Branches, design, and license

Work on `dev` and open PRs against `main`. Use conventional commits (`feat:`, `fix:`, `docs:`, `chore:`). Specs go in `docs/superpowers/specs/`; implementation plans go in `docs/superpowers/plans/`. Only v1 has an approved detailed design; later versions need their own spec first. Keep changes surgical and document verification in the PR.

Pathwise is [AGPL-3.0](LICENSE). Contributions use the same license (inbound = outbound). Preserve [NOTICE](NOTICE), including source attribution, and update pinned taxonomy versions truthfully when the bundle changes.

## Recording the demo GIF

Run `SEED_DEMO=true docker compose up -d` and `docker compose exec worker pathwise admin reset-password demo@pathwise.local`. Use the disposable demo account. Record 15–20 seconds at 1280×720 with Peek, Kap, or ScreenToGif: sign in → Today → Coach (scroll the seeded conversation) → Plan. Do not include the operator terminal or real credentials.

Convert the recording:

```bash
ffmpeg -i demo.mp4 -vf "fps=12,scale=960:-1:flags=lanczos" -loop 0 docs/assets/demo.gif
```

Keep it under 5 MB, preview the loop, and then uncomment the demo image line in [README.md](README.md) after `docs/assets/demo.gif` exists. Adjust duration or palette if needed to meet the size limit.
