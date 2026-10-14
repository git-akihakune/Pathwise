# UX Contract

## Product context

Pathwise is a global, English-first career coach. Primary jobs are exploration, planning, reflection, and reviewing proposed changes. UI locale is en-GB; numeric usage retains en-US where established. Scheduling uses the saved user timezone. Native calendar controls follow the user's platform locale and Gregorian ISO date storage. Target: WCAG 2.2 AA.

## Business-context sources

| Domain / scope | Authoritative source | Source type | Reviewed date |
|---|---|---|---|
| Routes and workflows | `docs/superpowers/specs/2026-10-12-pathwise-design.md` §§3.5–3.6, 5.5 | Approved product design | 2026-10-14 |
| Proposals and staleness | same spec §5.4; core proposal services | Domain contract | 2026-10-14 |
| Permission, keys, deletion | same spec §§6.6, 10; core auth/services | Domain contract | 2026-10-14 |
| Provider errors and manual use | same spec §9 | Product contract | 2026-10-14 |

## Visual contract

`DESIGN.md` records the approved identity. Runtime CSS in `apps/web/src/app/globals.css` is canonical, adapted through Tailwind v4 semantic tokens. Light, Dark, and System modes share the same semantic tokens and ink sidebar. System follows browser preference until explicitly overridden; the choice persists locally, synchronizes across tabs, and applies before hydration. Storage failures retain a usable in-memory choice. ThemeSelect is the canonical accessible selector across desktop/mobile headers and auth screens. Decorative motion respects reduced-motion preference. Change this document, shared primitives, and runtime tokens together when changing a durable contract.

## Canonical UI Map

| Capability | Canonical owner | Source of truth | Allowed variants | Verification |
|---|---|---|---|---|
| Select/Listbox | `components/ui/select.tsx`; native selects for simple form values | DESIGN.md and this contract | authored provider popup; native simple dropdowns | settings E2E; keyboard and open popup |
| Date | `components/ui/input.tsx` | core date-only and schedule contracts | native date/time; typed month/year experience values | plan and settings E2E |
| Form | `components/entity-form.tsx`, auth/provider forms, shared field controls | core server validation | create/edit, workflow, settings | domain and auth E2E |
| Theme | `components/theme-provider.tsx`, `components/theme-select.tsx`, `lib/theme-script.ts` | DESIGN.md; globals.css theme tokens | Light, Dark, System; browser-local preference | theme E2E; pre-hydration, mobile, keyboard, storage failure |
| Scrollbar | `app/globals.css` | DESIGN.md | stable document gutter; horizontal table overflow | computed styles and narrow-viewport E2E |
| CRUD | server actions through user-scoped core services | approved v1 spec and existing routes | inline save; Stories return to list | profile, plan, stories E2E |

## Component behavior

Enabled controls have hover, pointer, pressed, and visible focus states. Disabled controls cannot submit. Buttons preserve geometry while pending. Textareas do not manually resize; they grow with content within a cap. Password/API-key fields start masked and provide explicit show/hide buttons. Product forms use noValidate; server validation remains authoritative and entered non-secret data survives failures. Pending submits expose busy state and block duplicates.

## Dataset navigation

Personal profile/story/plan collections render as naturally scrolling sections; chat uses Load earlier messages. Admin tables use client pagination over the complete service result; they do not imply server-side paging. Provider configurations and short queue summaries render in context. Administrative pagination is transient and local to each table, avoiding multiple unrelated page parameters on one settings/admin screen; clamp pages when rows disappear. Tables retain native semantics and horizontal overflow on mobile. Large server result size is an existing backend limitation; this UI change does not redefine domain query interfaces.

## Flow ledger

| Operation | Trigger | Pending | Success destination | Success feedback | Failure recovery | Focus outcome | Source ref |
|---|---|---|---|---|---|---|---|
| Profile/plan edit | Add/Edit then Save | submit disabled | same section | refreshed saved content | inline error, preserve fields | owning section | domain actions |
| Story create/edit | Add story/Edit then Save | submit disabled | Stories | saved story in list | inline error | route heading | stories actions |
| Delete record | Delete/Remove then confirmation | confirm disabled | same collection | item removed | inline confirmation error | next surviving control | ConfirmDelete |
| Proposal resolution | Approve/Edit/Reject | controls disabled | same card | Approved/Rejected; conflict recovery | inline error or Regenerate | same decision context | proposal-card and core §5.4 |
| Provider test | Save and test/Test | controls disabled | same settings panel | detailed capability results | inline error; edit/retest | same settings context | provider-form/list |
| Upload | file picker/paste | persistent parsing status | review step | extracted data for user review | paste/retry/skip | next workflow step | onboarding |
| Weekly action | checkbox | optimistic, temporarily disabled | same row | checked state, textual progress | rollback and inline error | checkbox | today-actions |

## Navigation and responsive behavior

Titles are `{Screen} | Pathwise`; nested editors get their own title. Desktop sidebar becomes an accessible modal drawer below 1024px. Drawer closes on route selection, Escape, or explicit close and restores trigger focus. A first-focus skip link targets main. Route errors keep the shell navigable and provide Retry; not-found offers a route home. Existing server permission enforcement and admin redirects remain authoritative. Long names and content wrap; no mobile operation disappears.

## Overlays and feedback

Use shared Radix Dialog for modals and the canonical inline confirmation for record removal. Account deletion retains its typed confirmation. Never call browser alert/confirm/prompt. Failures stay adjacent to the operation; success statuses are polite live regions. Destructive feedback never claims success before the server confirms. Secrets never appear in feedback. Dialogs are bounded to the viewport with scrolling. Modal z-index is above the mobile header and composer.

## Async and resilience

Pessimistic saves by default; weekly checkboxes retain established optimistic rollback. Chat retains persisted partial replies, Retry/Regenerate, grouped sessions, and older-history paging. Composer allows drafting while a reply streams; duplicate send is blocked. Search ignores stale requests and IME composition. Offline mutations surface errors and preserve inputs; no secret/client persistence or new offline queue is introduced. Workflow runs resume from server state. Version conflicts keep the user in context. Auth redirects preserve the validated return route. Transport failures keep action forms open with a generic, non-secret error; an unknown result asks users to review the current data before retrying. Next.js redirect/not-found control flow is rethrown unchanged.

## Validation

Core schemas/actions validate domain fields. Shared form controls provide native constraint metadata without native popup UI; validation errors expose associated text and focus recovery. Non-secret values are preserved after server failures; passwords are not persisted. Sensitive values are masked, reveal is local and resets on navigation. Unsaved editing uses an app-owned discard prompt for application links and beforeunload for closing the tab; successful saves clear dirty state only for the submitted revision. Browser Back/Forward inside the client router is not intercepted. Explicit Cancel and switching inline editors retain the existing single-editor behavior. Controlled resource rows and chat drafts supply explicit dirty state.

## Permission and clipboard

Admin navigation is shown only to admins; authorization remains server-side. Existing clipboard operations require an explicit user action and do not put full secrets in statuses. Do not add permission or data lifecycle behavior during a visual migration.

## Verification

Run pnpm lint, pnpm typecheck, pnpm test, pnpm build, and pnpm e2e. Run the premium static audit against apps/web/src using premium-ui.json. Browser evidence covers desktop and 360–390px screens, active/nested navigation, keyboard drawer dismissal/restoration, skip link, forms, success/error, provider popup, chat, and domain workflows. Existing domain E2E are the canonical sibling flows; e2e/ui.spec.ts protects the new shell. No claim of full WCAG certification follows from static checks.
