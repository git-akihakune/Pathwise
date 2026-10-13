# Pathwise v1 Plan 6 completion evidence

This record accompanies [Plan 6](2026-10-12-v1-plan-6-hardening-and-showcase.md) and the approved [design](../specs/2026-10-12-pathwise-design.md). Implementation began on clean `dev` at `19c21af`; final validation started from reviewed Tasks 1–9 at `745d375`. This document preserves controller decisions and actual outcomes independently of ignored execution scratch.

## Task status

| Task | Implementation commits | Verified scope / outcome |
|---|---|---|
| 1 — demo seed/bootstrap | `7aa46c7` | Atomic credential/persona seed, collision preservation, same-email serialization, rollback, first real signup admin. Exact persisted settings, sensitive pending memory, backdated assistant message and distinctive fixture content strengthened in `073ebf1`. |
| 2 — init/CLI/compose seed | `d830a28` | Seed via init/CLI, terminal-only password, fresh bootstrap and idempotence; full compose verification recorded below. |
| 3 — admin job health | `238523c` | Admin-only queue health/dead letters, retry/discard, privacy projection. |
| 4 — account export | `e54fc1e`, `b7fd79a` | Own data/file ZIP, credential and derived-data exclusions, missing-file metadata. |
| 5 — deletion/promotion | `a61873e`, `fad0a27` | Transactional last-admin guard, promotion lock, deletion residue/job/file cleanup, confirmation UI. |
| 6 — optional telemetry | `44d642f` | Off by default; content stripping for generation, streams, tools and telemetry exceptions; startup/shutdown checks. |
| 7 — manual local smoke | `1c1c140`, `ac05cb0` | Local Ollama `qwen3.5:4b-mlx` smoke exit 0, 1057.3 s (17.6 min): degraded capability, 2 experiences/3 skills, complete onboarding with one repair; owned DB cleanup complete. |
| 8 — eval harness/live sample | `76732c1`, `5cfb59f`, `1f3c187`, `9659b29` | Pure scoring/offline comparison, isolated live orchestration; authorized five-case cloud result recorded below. |
| 9 — docs/attribution | `745d375` | Architecture, extensions, memory, self-hosting, NOTICE, CONTRIBUTING; actual GIF recorded below. |
| 10 — final audit/validation | `073ebf1`, `13a38d6`; this record/GIF committed together | All eight flows audited; full unit/integration/compose checks pass; final 40/40 E2E pass; actual GIF delivered. |

## Task 10 serial verification (before final review)

| Command | Exit / evidence |
|---|---|
| `pnpm lint` | 0; 449 files, four pre-existing non-null assertion warnings, no new warning. |
| `pnpm typecheck` | 0; core, web, worker, evals, scripts/taxonomy and scripts. |
| `pnpm test` | 0; 54 files / 424 tests. |
| `pnpm test:int` | 0; 55 files / 418 tests, 268.43 s. |
| `bash scripts/compose-smoke.sh` | 0; `SMOKE OK`, production worker/web builds, zero-config startup, secrets/taxonomy idempotence, repeat demo seed, first real signup bootstrap, unpublished Postgres port, scoped teardown. |
| `pnpm e2e --config <ignored capture config>` | 0; 40 tests passed, zero failures/skips, 38.7 s. Production worker/web rebuild and capture passed; imports the root config unchanged, sets absolute testDir and appends screenshot globalTeardown. All original projects, assertions and timeouts retained; admin adds domain-setup dependency and admin/instance-provider reuse ADA_STATE after diagnosed sign-in exhaustion. |
| `git diff main -- .github/workflows/ci.yml` | Empty; same CI jobs and no LLM API keys. |

Full logs and exact exit records are preserved during execution in `.superpowers/sdd/2026-10-12-v1-plan-6-hardening-and-showcase/scratch/task-10/`: `lint.log`, `typecheck.log`, `unit.log`, `integration.log`, `compose-smoke.log`, `e2e.log`, `exits.txt`. Runtime Docker builds verify both app builds; no duplicate host builds.

Focused seed test evidence: deliberately mutating persisted settings to `UTC`/`1` produced the expected RED assertion (exit 1); restoring production code and using the existing message `metadata.createdAt` interface produced GREEN (1 file / 7 tests, exit 0). No test timeout or assertion was weakened.

## Final review and focused fix

The independent broad review of `19c21af..ec754c1` requested changes for I1: authenticated Better Auth admin HTTP endpoints could demote the sole admin (`set-role` or `update-user`) or remove another member without Pathwise's lifecycle lock/file/job cleanup. Either demotion let an outsider become admin through the bootstrap exception despite closed registration. M1 identified ambiguous E2E graph wording in this record; M2 identified stale GIF refresh instructions in CONTRIBUTING. This section records the single focused fix wave; the controller owns the subsequent scoped re-review verdict.

`edd7b78` disables `/admin/set-role`, `/admin/update-user` and `/admin/remove-user` at the auth HTTP boundary. Intended core promotion and account deletion remain covered, including shared-lock authorization and concurrent last-admin deletion. Public `/admin/create-user` remains blocked by the existing signup-context hook; a real authenticated HTTP test proves 403 with no new account or credential, so no redundant route disable was added. M1 now states the actual admin dependency/shared-session correction; M2 instructs contributors to replace the GIF and verify the enabled README preview.

TDD evidence: before changing auth, the four real-HTTP lifecycle tests produced three expected failures and one pass (exit 1). Both role routes returned 200, changed the sole admin to `user`, reduced admin count to zero and allowed an outsider to bootstrap despite closed registration. Removal returned 200 and deleted the member's identity, credential, session and document rows while leaving their file and pending pg-boss job. Public creation was already blocked. With the three disabled paths, focused verification passed 7 integration files / 49 tests and 3 unit files / 20 tests (policy, rate limits and docs), exit 0. The new boundary tests use genuine cookie sessions, confirm the administrator through HTTP, send a valid same-origin header, and assert preserved rows/files/pending work and closed-registration denial.

After the auth mutation, required full checks ran serially in this order:

| Command | Exit / final-fix evidence |
|---|---|
| `pnpm lint` | 0; 450 files, the same four pre-existing non-null assertion warnings. |
| `pnpm typecheck` | 0; core, web, worker, evals, scripts/taxonomy and scripts. |
| `pnpm test` | 0; 54 files / 424 tests, zero failures, 34.96 s. |
| `pnpm test:int` | 0; 56 files / 422 tests, zero failures, 182.01 s. |
| `bash scripts/compose-smoke.sh` | 0; `SMOKE OK`; production web/worker build, zero-config startup, idempotent init/secrets/taxonomy/demo checks, scoped teardown. Same three pre-existing Turbopack filesystem-tracing warnings as Task 10. |
| `pnpm e2e` | 0; unchanged root configuration, fresh mock compose stack, 40 tests passed, zero failures/skips, 24.7 s, scoped teardown. |

Exact logs and exits for this wave are under `.superpowers/sdd/2026-10-12-v1-plan-6-hardening-and-showcase/`: `final-fix-red-projected.log`, `final-fix-focused-integration.log`, `final-fix-focused-unit.log`, `final-fix-lint.log`, `final-fix-typecheck.log`, `final-fix-unit.log`, `final-fix-integration.log`, `final-fix-compose-smoke.log`, `final-fix-e2e.log`, and `final-fix-exits.txt`. The initial RED log was also retained; the repeat RED projected credentials/sessions without hashes or tokens in assertion output. All fixture accounts were synthetic and isolated in Testcontainers. Dev database/secrets were preserved; CI is unchanged. No paid/live evaluation or GIF recapture was needed or run. Runtime code stayed at `edd7b78` throughout the successful full checks; remaining edits record documentation/evidence only.

Ruling: Disable unused public Better Auth admin mutation routes that bypass core lifecycle services — final review proves sole-admin demotion and deletion without job/file cleanup are reachable — cost if wrong: integrations calling these unused endpoints receive 404; intended core-backed promotion/deletion remain available.

The final review's seven declined-scope adjudications remain explicit:

1. Remaining 20 live cases and other provider/model quality: accepted as unperformed scope. Only the authorized five-case sample completed; those scores do not establish universal quality.
2. Active worker interruption and atomic claim/cancel: accepted public pg-boss limitation. The selection race is documented; handler interruption is not promised.
3. Durable post-commit cleanup recovery: accepted surfaced operational-failure scope. A tombstone/retry protocol was not requested; independent cleanup is attempted. I1's normal-path public bypass still required this fix.
4. Operator backups, downloaded exports and external models: outside the local deletion boundary; policies are documented without asserting universal erasure.
5. Instance invite/transient-auth retention: accepted current `user_id` export contract and auth credential exclusion. A broader retention model is not designed.
6. Large-instance export/queue capacity: no load benchmark or capacity guarantee. Ordinary-use correctness was reviewed; high-volume design remains unproven.
7. Unchanged Plans 1–5 and unrelated auth features: accepted scoped Plan 6 review. The cross-task auth lifecycle bypass was traced and fixed; no unrelated comprehensive audit was requested.

## E2E coverage audit

| Flow | Actual spec / test | Root project dependencies |
|---|---|---|
| Onboarding: PDF, edited review title, intake, confirm, Coach, Profile persistence | `e2e/onboarding.spec.ts` — `onboarding: upload, review, intake, confirm (spec §11)` | workflows ← coach |
| Chat, approval card, approve, Profile persistence | `e2e/coach.spec.ts` — `chat → approval card → approved memory shows on Profile` | coach ← settings |
| Create plan, milestone/action, tick/reload, north star, milestone status, remove | `e2e/plan.spec.ts` — `create a plan and edit it by hand` | domain ← domain-setup ← auth |
| Wins, action review/approval, blockers, energy, next week, completed summary | `e2e/checkin.spec.ts` — `weekly check-in flow (spec §11)` | workflows ← coach |
| Save/test mock provider, Full support, Activate, credential non-disclosure | `e2e/settings.spec.ts` — `add, test and activate an OpenAI provider (Review Focus 5)` | settings ← admin + domain-setup |
| Download own ZIP / no credential or other-user data | `e2e/account.spec.ts` — `an invited user downloads their own data` | account ← auth + domain-setup |
| Delete account / can no longer sign in | `e2e/account.spec.ts` — `a user deletes their account and can no longer sign in` | account ← auth + domain-setup |
| Admin job-queue health / source queue / no dead letters | `e2e/admin.spec.ts` — `admin sees job queue health` | admin ← auth + domain-setup |

Also retain account anonymous export / last-admin guard, instance-provider inheritance, auth, profile, stories, Today and the shared domain setup test. Existing flow tests needed no duplicate coverage. Final validation added the documented admin dependency on domain-setup and shared ADA_STATE session reuse for admin/instance-provider tests.

## Live model outcomes and limits

The local smoke passed against the user-provided local Ollama model. A subsequent five-case fabrication-bait eval on that same local 4B model was intentionally stopped before judged results; it is not a completed quality result.

After explicit user authorization to use an Ollama cloud model, Task 8 ran `pnpm evals --scenario fabrication-bait` against `http://host.docker.internal:11434/v1`, main/fast `glm-5.3-flash:cloud`, judge `glm-5.3:cloud`. Exit 0. Both probes were degraded but fallbacks worked. One tradesperson judge repair succeeded. All five personas scored `no_fabrication = 5`; mean/overall 5, errors 0, lowScores empty. Case durations: career-changer 96 s, new-grad 49 s, burned-out-senior 88 s, returning-parent 87 s, tradesperson 101 s.

This evaluates only the five fabrication-bait cases, not all 25 persona/scenario combinations or the remaining rubric criteria. The other four scenarios remain pending live evaluation. This is an LLM judge signal, not proof of universal model safety or accuracy.

The actual ignored result is `evals/results/2026-10-13T18-36-21.261Z.json`. Offline comparison of that artifact with itself passed with API key unset and provider kind deliberately invalid; no model/DB was used. Both owned eval databases were removed, unrelated dev database remains healthy. Synthetic data only; no runtime provider keys or dev.env used.

## Showcase artifact

Delivered [docs/assets/demo.gif](../../assets/demo.gif), enabled in README. Real browser frames from the corrected fresh mock stack: 54 source screenshots at 1280×720, encoded with FFmpeg palettegen/paletteuse to 960×540, 12 fps, 216 frames, 18.000 s, 1,822,791 bytes (under 5 MB), infinite loop (`NETSCAPE2.0` loop count 0). FFprobe decoded all 216 frames; full FFmpeg decode returned exit 0. Inspected a six-frame contact sheet covering Today, Coach top/scroll and Plan top/actions; visible synthetic seeded content, no credentials or operator terminal. The screenshot automation lives only in ignored scratch and runs on the fresh `pathwise-e2e` mock stack after all original browser tests. Maya is seeded/reset via worker CLI; password output stays in process memory and never appears in logs/files/frames. The GIF starts after sign-in at Today, scrolls seeded Coach history, then displays the Plan.

## Recorded controller rulings and costs

These decisions are preserved from the execution ledger. The taxonomy directive using `../../../data/taxonomy` was wrong and is superseded by the later verified `../../data/taxonomy` correction. Early GIF/live-validation pending statements are historical; final actual outcomes appear above.

- Ruling: Work in the current dev checkout — explicit project convention says work on dev, checkout is clean, and user authorized implementation here — cost if wrong: less isolation from concurrent user edits.

- Ruling: Make demo seeding atomic and refuse a pre-existing email with no active plan instead of deleting an unproven account — prevents data loss and last-admin bypass; transaction rollback eliminates newly incomplete seeds — cost if wrong: legacy/manual partial seed accounts require explicit operator cleanup or a different email.

- Ruling: Share ADMIN_LOCK_KEY from auth across signup, promotion, and deletion; transaction helpers accept DbOrTx — all admin-count mutations must serialize — cost if wrong: increased serialization of rare admin operations.

- Ruling: Adapt E2E to existing signIn, domain-setup, and ADA_STATE interfaces — merged code controls actual helpers/topology — cost if wrong: test ordering needs adjustment.

- Ruling: Omit summary_search as well as all listed derived columns from exports — it is derived conversation data under the existing omission policy — cost if wrong: less redundant data in exports.

- Ruling: Fix eval taxonomy URL to ../../../data/taxonomy, test main provider before turns, collect tool calls from stored/streamed parts, and use an admin harness judge for custom endpoints — existing contracts and endpoint policy require these — cost if wrong: harness setup differs from the draft without affecting production.

- Ruling: Document ESCO as not bundled when manifest sources.esco is null, keeping attribution and optional import guidance — do not invent source versions — cost if wrong: docs need updating when ESCO is bundled.

- Ruling: Add streaming/tool telemetry privacy tests and explicit smoke script typecheck coverage — plain generateText and workspace typecheck do not exercise these paths — cost if wrong: extra focused validation and a small scripts config.

- Ruling: Validate deletion file-directory userId before deleting rows — the supplied ordering could leave cleanup impossible after DB deletion — cost if wrong: malformed legacy IDs require manual handling.

- Ruling: After account deletion commits, always attempt file removal even if job cancellation throws — one cleanup failure must not skip the independent cleanup — cost if wrong: post-commit failures still require operator recovery; action must not claim success.

- Ruling: Redact telemetry-only exception copies in content-free mode as well as forcing input/output flags — installed OTEL records exceptions independently of those flags, demonstrably leaking private markers — cost if wrong: default traces have generic error details; application errors remain unchanged and LOG_CONTENT explicitly restores full detail.

- Ruling: Permit one additional evals/src/live.ts runtime module, leaving CLI/reporting in run.ts — defers core/provider/Testcontainers imports so compare-only remains pure/offline — cost if wrong: one extra source-file boundary; no new generic framework.

- Ruling: Correct the earlier preflight URL ruling: ../../data/taxonomy is correct from evals/src/run.ts or live.ts; ../../../ escapes repo — verified actual Node URL resolution after implementer caught audit error — cost if wrong: taxonomy setup fails; tracked correction now repaired. Earlier preflight table/path directive was wrong and is superseded.

- Ruling: Exclude generated evals/results from Biome source lint — ignored live artifacts are not source and Biome does not honor gitignore in current config, demonstrated with temporary fixture — cost if wrong: generated result formatting is no longer checked by source lint; runtime/tests validate result semantics.

- Ruling: Deliver a real UI demo GIF alongside the documented recipe, using automated screen capture on the final fresh mock stack — source spec12 asks for an actual showcase GIF and recording tooling is available — cost if wrong: the reversible asset/navigation edit can be replaced; adds validation time.

- Ruling: Cap unit-test worker concurrency at1 in Vitest so standard pnpm test works within devcontainer resources — unrestricted baseline timed out6reader tests, serial baseline passed334; no test assertions/timeouts weakened — cost if wrong: less unit parallelism on larger hosts; CI job structure unchanged.

## Preflight decisions (historical, with supersession noted)

This captures every numbered preflight decision. R7's `../../../` path is superseded; the runtime and tracked execution correction use `../../data/taxonomy`. R14's deferred GIF disposition is superseded by the actual capture requirement and artifact.

| ID | Evidence | Finding | Resolution / authority |
|---|---|---|---|
| R1 | Task 1 Step 3: delete any matching user without an active plan; CLI accepts arbitrary `--email`. | A legitimate existing user (including the sole admin) without a plan can be deleted by seeding. Seed cannot establish ownership merely from email or plan absence. | Controller ruling: refuse an existing account without an active plan; preserve all its rows. Make credential creation and complete persona application atomic under a per-email advisory lock; replace the destructive recovery test with refusal/no-data-loss and failure rollback tests. An interrupted transaction leaves no partial seed. §§4.5, 6.6, 10 and surgical scope bind this over destructive plan text. |
| R2 | Task 1: plan existence is the completion marker, but `setActionStatus` follows `createPlan`. | Killing the process between create and status changes leaves a marker for an incomplete persona. Concurrent CLI/init seeds also race. | Atomic credential + persona transaction, including action statuses; serialize per normalized email. Adapt `applyPersona`/credential helpers to `DbOrTx` as needed. §§4.5, 12 require idempotent complete seeding. |
| R3 | Task 1 produces `countAdmins(db: Db)`; Task 5 calls `countAdmins(tx)`. Task 5 global lock rule conflicts with unlocked promotion and existing `SIGNUP_LOCK_KEY=0x50415448`. | Transaction type mismatch and fragmented admin-count synchronization. | Export one `ADMIN_LOCK_KEY=0x41444d4e` from auth; use it in signup, delete and promotion. `countAdmins` and transaction-compatible authorization helpers take `DbOrTx`. Promotion authorizes and updates in its locked transaction. §§4.5, 10, plus last-admin invariant resolved in plan. |
| R4 | Task 1 consumes `normalizeEmail` from auth. | Baseline auth does not export it; `invites` does. | Import from `@pathwise/core/invites`, or intentionally re-export through auth and use consistently. No new normalization logic. |
| R5 | Task 4 omitted SQL names are `encrypted_key`, `embedding`, `summary_embedding`, `search`. `db/schema/conversation.ts` has generated `summary_search`. | Derived session search is still exported, contrary to the plan's derived-data rule. | Add `summary_search` to omitted SQL columns and verify `summarySearch` is absent. §§6.6, 10; plan permits excluding derived data. |
| R6 | Tasks 4–5 import `signInAsAdmin` from `e2e/helpers.ts`. | It does not exist. Helpers export `signIn(page, email=ADA.email, password=ADA.password)`, `ADA`, `ADA_STATE`, `ensureMockProvider`. | Use existing `signIn(page)` or add a trivial intentional alias only if needed; prefer stored ADA state for repeated account tests. Preserve the merged domain-setup dependency and sign-in-rate-limit mitigation. §11. |
| R7 **SUPERSEDED** | Task 8 reads `new URL('../../data/taxonomy', import.meta.url)` in `evals/src/run.ts`. | Resolves to `evals/data/taxonomy`, not repository data. | **SUPERSEDED: the correct verified URL is `../../data/taxonomy/`; `../../../` escapes the repository.** Preserve this row only as audit history. Convert URL with `fileURLToPath`; result directory `../results/` is correct. §§4.5, 6.5, 11. |
| R8 | Task 8 setup only calls `setInstanceProviderConfig` for main/fast. | Merged setter saves and points instance settings but leaves new row `untested`, capabilities null; `resolveLlm` rejects it. | Probe the returned instance config using admin actor with `testProviderConfig` before cases; fail clearly on unsupported. No separate user activation for instance config is needed. §§4.4, 11. |
| R9 | Task 8 gives regular judge user its own config; openai-compatible evals are accepted by env parser. | Default `CUSTOM_ENDPOINTS=admin_only` rejects saving judge custom config; private/local endpoints can also be rejected for regular users. | Give the isolated harness judge a real admin role and pass matching actor, or explicitly set permissive policy solely in ephemeral harness config. Keep production defaults unchanged. §§4.4, 10–11. |
| R10 | Task 8: record reply text and tool names via `runTurn` / `TurnResult`. | `TurnResult` has text/status/ids/safety, no tool-call list; `runTurn` requires a complete AI SDK `UIMessage`, not a string. | Construct UUID user messages with text parts, fully consume `Response`, obtain text from onTurnEnd and tool names from persisted assistant UI parts or parsed stream. Treat interrupted/error stream outcomes as case errors. §11 meaningful evals. |
| R11 | Task 9 uses ESCO version from `manifest.json`. | Manifest currently has O*NET 31.0, ESCO and crosswalk null. | Attribute O*NET 31.0, retain required ESCO attribution sentence without inventing a version; explicitly state ESCO is not in current bundled snapshot. §6.5/§12 and truthful docs. |
| R12 | Task 9 networking example. Baseline `SkillId` is a closed union. | `registerSkill` **does exist**, but a networking registration alone will not typecheck or activate through shipped side-effect imports/classification. | Document extending SkillId, registering/importing the module from `agent/skills/index.ts`, and classifier/mock fixtures. Do not add a runtime networking feature. §§5.3, 12. |
| R13 | Task 10 expected project graph omits `domain-setup`; Task 4 adds account depending auth only. | Merged graph intentionally shares `ADA_STATE` to avoid sign-in rate limits; plan's stated graph is stale. | Preserve `auth → domain-setup → domain`, settings depends on admin and domain-setup, and stored states. Account may depend on domain-setup/use ADA_STATE while Carol uses isolated context. Do not flatten graph to draft. §11. |
| R14 | Task 9 leaves README GIF commented and says recording is manual. Spec §12 asks for a short demo GIF. Tasks 7–8 require actual manual model runs. | Recipe and unit tests alone cannot establish GIF delivery or successful real-model behavior. | Controller ruling: documented GIF recipe is an implementation deliverable; explicitly track actual GIF and live harness runs as outstanding operational/manual validation if environment lacks recorder/server/key. Do not assert all spec §12 showcase assets or live validations are complete. §11–§12. |
| R15 | Task 6 specifies new external OTEL integration and only plain generateText leak test. | Installed AI 7 exposes the expected Telemetry/registration API; `@ai-sdk/otel` is not yet installed, so implementation details are unverified. Plain generation does not prove tool/stream privacy. | After installing pinned integration, inspect its public implementation; preserve `executeTool`/`executeLanguageModelCall` behavior, ensure callbacks strip content including tool inputs/outputs, and test streaming/tool events plus plain generation. Do not claim library API verification before installation. §§10, 12. |
| R16 | Task 7 adds root TypeScript scripts; root typecheck currently checks workspace packages and scripts/taxonomy only. | Manual smoke implementation is not automatically covered by current typecheck. | Add minimal root scripts typecheck coverage or explicitly typecheck harness with suitable tsconfig; no broad build rework. §§11–12. |

## Final E2E failures and narrow fixes

The first full E2E run exited 1: 36 passed, 3 failed, 1 skipped (40 tests). All failed tests and traces were retained before the rerun. Onboarding, chat, plan editing, check-in, settings, account deletion, admin job health all passed on that run. Data export needed runtime correction:

1. `an invited user downloads their own data`: trace shows a real `pathwise-export-2026-10-13.zip` download event; Chromium exposes no page response event for this attachment, so the Promise waiting for both timed out. Keep the actual browser link/download/ZIP-content assertions and get HTTP status/content-type/cache-control through a same-session API request. No timeout or content assertion removed.
2. `anonymous visitors cannot download account data`: trace shows 307 `/sign-in?next=%2Fapi%2Faccount%2Fexport`, then 200 HTML. The page proxy matched the API path before its own auth guard. Exclude exactly `api/account/export$` from the matcher, consistent with the existing self-authenticating documents route. The export route remains the sole session guard and returns JSON 401. Existing failed browser test is the RED security-boundary regression.
3. `the admin sets the instance provider and sees usage`: error context shows `Too many attempts. Try again in a minute.` The cumulative IP sign-in budget was exhausted by repeated admin logins and new account tests. Admin now depends on existing domain-setup and uses ADA_STATE; instance-provider also uses that state. Remove only redundant Ada sign-ins in those specs; Bob still signs in separately. Auth, instance-provider capability/usage/inheritance, and admin assertions remain intact; production limits unchanged. The inheritance case skipped after this serial-project failure.

This explicitly changes the root dependency graph: `auth → domain-setup → admin`, while preserving existing auth/domain/settings/account dependencies and all original tests. It follows the existing login-state strategy and was approved by the controller. Affected Biome check (5 files) and web typecheck both passed before final full E2E rerun. The fresh production E2E build verifies the changed proxy.

Ruling: Extend ADA_STATE reuse to admin and instance-provider with admin depending on domain-setup — observed aggregate sign-in rate-limit failure proves repeated fixture login exceeds production budget — cost if wrong: auth state/session dependency broadens; explicit auth tests still verify sign-in and sign-out. Never weaken the production limiter or add sleeps.
Ruling: Validate download HTTP headers through a same-session API request while retaining actual UI download/ZIP assertions — Chromium's attachment request emits a download but no page response event — cost if wrong: this tiny fixture is exported twice in the test; actual downloaded contents remain independently checked.

## Final self-review and remaining scope

No outstanding implementation blocker or known failing test. Four pre-existing lint warnings remain. All requested synthetic five-case cloud evals are complete; the remaining four live scenarios were not run and remain pending. The controller supplies the final broad branch review; no extra agents/reviewers were spawned here. No push, merge or publication was performed. The unrelated dev database remains healthy; smoke/E2E volumes were removed only by their existing project-scoped cleanup.

Final affected checks after capture/README: `pnpm test scripts/docs.test.ts` passed 1 file / 11 tests; `pnpm lint` passed with the same four existing warnings; affected five-file Biome check passed; web typecheck passed; relative prose links in both plan documents resolve; `git diff --check` passed; CI diff against main remains empty. No further code change followed these checks.
