---
version: alpha
name: Pathwise
description: A calm career workspace that connects direction to weekly action.
colors:
  primary: "#176B63"
  background: "#F3F6F8"
  surface: "#FFFFFF"
  ink: "#172E43"
  muted: "#5C6F7C"
  border: "#DBE3E9"
  outline: "#8193A2"
  accent: "#E8F2EF"
  danger: "#B43B47"
typography:
  heading:
    fontFamily: "Manrope Variable, Manrope, system-ui, sans-serif"
  body:
    fontFamily: "Source Sans 3 Variable, Source Sans 3, system-ui, sans-serif"
  mono:
    fontFamily: "ui-monospace, monospace"
rounded:
  DEFAULT: "0.75rem"
  sm: "0.45rem"
  md: "0.6rem"
  lg: "0.75rem"
  xl: "1.05rem"
spacing:
  section-gap: "1.5rem"
  page-max: "76rem"
components:
  button:
    rounded: "{rounded.md}"
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface}"
  card:
    rounded: "{rounded.xl}"
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
  dialog:
    rounded: "{rounded.xl}"
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
  helper:
    textColor: "{colors.muted}"
  divider:
    backgroundColor: "{colors.border}"
  selected:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.primary}"
  error:
    textColor: "{colors.danger}"
---

# Pathwise Design System

## Overview

### Creative North Star

A career field guide: a quiet workspace for reflection, with a visible route from direction to milestones to the next small action. The path motif earns its place by representing the product's actual planning hierarchy.

### Product context and register

- Audience: people in any profession exploring direction and sustaining a career plan.
- Source: approved v1 product design in `docs/superpowers/specs/2026-10-12-pathwise-design.md`, especially §§3.5–3.7. Global, English-first; no Japan-specific market assumptions.
- Usage: desktop planning sessions and short weekly/mobile check-ins. Product register throughout, including authentication; no separate marketing site.
- Signature: the connected direction → milestones → weekly actions journey, restrained route graphics, and an ink-blue navigation surface.
- Restraint: forms, permission boundaries, approvals, and errors favor familiar controls and literal labels.
- Anti-references: motivational scoreboards, invented productivity metrics, generic AI gradients, chat personas, and sales-heavy dashboard copy.
- Approval: visual direction approved in this task on 2026-10-14.
- Ownership: existing runtime CSS is canonical (Model B). `apps/web/src/app/globals.css` owns values; Tailwind v4 `@theme inline` adapts them; shared primitives consume semantic utilities. This document mirrors accepted values and explains intent.

## Colors

Teal primary actions, ink text and sidebar, cool pale canvas, white panels. Muted copy remains legible. Pale teal marks selection without relying on color alone; current navigation also has `aria-current`. Field boundaries use the stronger outline token for contrast against white. Red belongs to errors and destructive actions. Light, Dark, and System modes share the teal-and-ink identity. System is the default; a browser-local preference persists explicit choices and synchronizes across tabs. A static pre-paint script applies the saved or system theme before hydration. The shared ThemeSelect uses the canonical Radix Select and is available in desktop/mobile headers and authentication. Dark mode uses a deep ink canvas (#101C29), blue panels (#182A3A), pale ink (#E3EDF5), muted copy (#AFC0CE), and soft teal (#7ED4C3) with dark primary-button text (#102C29). Runtime `.dark` overrides own every semantic role, field boundary, focus ring, chart, and scrollbar color. Forced colors use system colors.

| Document role | Runtime variable | Consumer |
|---|---|---|
| primary | `--primary` | Button, links, focus |
| background | `--background` | document canvas |
| surface | `--card`, `--popover` | panels, dialogs, fields |
| ink | `--foreground`, `--sidebar` | text and navigation |
| muted | `--muted-foreground` | helper text |
| border | `--border` | panel dividers |
| outline | `--input` | field and checkbox boundaries |
| accent | `--accent` | selected and hover surfaces |
| danger | `--destructive` | error and delete |
| heading/body | `--font-heading`, `--font-sans` | shared headers and document |

## Typography

Self-hosted Manrope headings and Source Sans 3 body text, packaged with the application. No runtime font fetch and no boot-time network dependency. Headings use compact tracking and restrained semibold weight; body text has comfortable line spacing. Body 16px, utility 14px, captions 12px, page headings 28–34px. Use tabular numbers for progress and usage. Sentence case and descriptive verbs throughout.

## Layout

At 1024px and above, a 248px fixed sidebar supports frequent navigation; the remaining document scrolls naturally. Below 1024px, a compact header opens the shared Radix modal navigation drawer. Content is capped at 76rem with responsive 20–40px padding. Today uses an asymmetric main/support grid on wider screens, stacking on mobile. Panel sections have 24px spacing. All content can wrap; long forms retain document scrolling. Tables own horizontal overflow, never the full page. Safe-area insets protect mobile chrome.

## Elevation & Depth

Use surface color, thin borders, and a very light panel shadow for hierarchy. Only dialogs and menus have stronger elevation. Sticky chat input stays opaque; no decorative blur behind reading content.

## Shapes

12px base radius, 9.6px controls, 16.8px panels. The path motif uses small round nodes joined by a thin line; those nodes are symbolic, never disguised as interactive controls. Pills are reserved for status and metadata.

## Components

### Foundational visual states

Shared Button, Input, Textarea, Select, Card, Alert, and Dialog own state treatment. Enabled targets have hover and visible keyboard focus. Disabled controls are inert and visibly muted. Loading uses an app-owned spinner/status with reserved space, not a skeleton. Error text persists until corrected or retried.

### Buttons and actions

Teal solid is the safe primary action, outline is secondary, ghost is utility, red is destructive. Button dimensions remain stable when busy. Use accessible names for icon controls. Never make a decorative card a click target.

### Navigation and data display

Navigation items always carry an icon and text. Active items have a visible filled marker and `aria-current`. Counts represent actual stored data only. Use panel headers and explicit empty-state guidance; paginate larger administrative datasets without changing service contracts.

### Forms and overlays

Keep visible labels, adequate spacing, masked secrets with explicit reveal, app validation, and disabled duplicate submits. Native date/time and simple selects deliberately retain platform popups; provider dropdowns use shared Radix Select. Modal surfaces own focus, Escape, scroll bounds, and restoration. Alerts remain inline and accessible.

### Iconography

Lucide, generally 18–20px, 1.7–2px stroke. Icons support text; they never replace the label of a key operation. The Pathwise mark is a small route with three nodes.

### Motion

Brief 150ms color and opacity transitions; no ambient animation. Reduced motion removes nonessential transitions and animations. Streaming status is communicated in text as well as the indicator.

### Content and data visualization

Warm, literal, non-judgmental English. Never invent a coach note, career target, success statistic, or streak. Progress is actions completed divided by actual weekly actions, accompanied by text. Dates use the user's saved timezone; date-only values remain date-only.

## Do's and Don'ts

- Do keep direction, milestones, and next actions visually connected.
- Do use shared panels, headers, feedback, and control states across every route.
- Don't fabricate activity to fill an empty dashboard.
- Don't bury approvals, failures, privacy controls, or primary actions behind decoration.
