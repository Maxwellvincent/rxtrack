# Design System + Shell Foundation — Design

**Date:** 2026-06-19
**Status:** Approved (design), pending spec review
**Branch:** `app-rework`
**Audit:** `docs/superpowers/specs/2026-06-19-app-audit.md`

## Where this fits

First of three sub-projects in the RXTrack redesign (see audit):
1. **Design-system + shell foundation** ← this spec
2. Adaptive learning engine (Teach↔Recognize↔Test, Claude tutor) — later spec
3. Recognition generation strategy — later spec

This sub-project builds the modern UI foundation and the app shell as a coded,
data-wired **prototype** the user approves before broad rollout. It deliberately
does NOT implement the adaptive engine or migrate every view — it creates the
stack, the component kit, the shell, and one fully-wired view (block home) so
everything else has surfaces to build on.

## Goal

Stand up Tailwind + shadcn/ui in the existing Vite/React 19 app, build a
token-bound component kit and the **Direction B (Focus Dark / Command)**,
**Compact** shell — sidebar term/block tree, breadcrumb header, ⌘K command
palette, single adaptive "Continue learning" entry — wired to real data for the
sidebar and block home, in dark + light, preserving the colorblind-safe status
palette. The current app keeps working throughout (the new shell renders behind
a flag).

## Decisions (from brainstorming)

- **Stack:** Tailwind CSS + shadcn/ui (Radix primitives), staying on Vite +
  React 19. Replaces ad-hoc inline `style={{}}`.
- **Direction:** B — dark-first, dense, high-contrast, mono accents, command
  palette. **Compact** density.
- **Preserve:** colorblind-safe status palette (blue/amber/purple/cyan +
  dot/diamond shapes), dark + light, desktop-first sidebar, term→block→lecture.
- **Single adaptive entry:** the 4 mode buttons collapse to one **"Continue
  learning"** CTA. In this sub-project it's a styled placeholder that routes to
  the existing study flow; the real adaptive orchestration is sub-project #2.
- **Prototype-first, incremental rollout:** new shell lives alongside the
  existing app (feature flag), not a rewrite. Migrate views later.

## Architecture

New, isolated modules (keep `App.jsx` untouched initially):

- `src/ui/` — the component kit (shadcn-generated + thin wrappers): `Button`,
  `Card`, `Panel`, `Input`/`Field`, `Badge` (status-aware), `Dialog`/`Modal`,
  `CommandPalette`. Each bound to design tokens, themeable, documented by usage.
- `src/shell/` — `Shell` (layout frame), `Sidebar` (term/block tree + search +
  footer stats), `Header` (breadcrumb + theme toggle + profile), `BlockHome`
  (first wired view), `CommandPalette` wiring (⌘K).
- `src/theme/tokens.{css,ts}` — design tokens: status palette (from existing
  `theme.js`), fonts (Plex Sans/Mono + Fraunces), spacing scale, type scale,
  radii, elevation, dark/light via a `class` strategy (`.dark`).
- `tailwind.config.js` + `postcss.config.js` + shadcn `components.json` — config.
- A flag (e.g. `localStorage["rxt-new-shell"]` or `?shell=new`) that mounts the
  new `Shell` instead of the legacy `App` render, reading the SAME data stores
  (terms/blocks/lectures/objectives) so both render real content.

**Data:** the shell reads existing localStorage/Supabase state through the
current helpers (terms, blocks, lectures, objectives, coverage) — render layer
only; no data-model changes.

**Isolation rationale:** `src/ui` (look) and `src/shell` (layout) have clear
boundaries and can be understood/tested without touching the 40k-line `App.jsx`.
Each component answers: what it renders, the props it takes, the tokens it uses.

## Components & surfaces (this sub-project)

1. **Component kit** (`src/ui`): Button (variants: primary/ghost/outline),
   Card/Panel, Input/Field, Badge (maps status→colorblind palette + shape),
   Dialog, CommandPalette. shadcn install + token binding + a small usage demo.
2. **Shell frame**: sidebar | header | main, Compact spacing scale, dark default
   + light, sticky header, scroll area.
3. **Sidebar**: term sections → block rows (status dot/diamond, name, lecture
   count, coverage %), search box (opens ⌘K), footer stats. Reads real terms.
4. **Header**: breadcrumb (Term / Block), theme toggle, profile menu.
5. **⌘K command palette**: fuzzy jump to blocks + a few commands (placeholder
   actions: "Recognize: <block>", "Go to <block>"). Keyboard-driven.
6. **Block home**: block title + meta (lectures / objectives / exam-in), single
   **"Continue learning"** CTA (routes to existing study flow for now),
   objectives/lectures rows with coverage + weak flags. Compact density.

## Data flow

`flag on` → mount `Shell` → `Sidebar`/`Header`/`BlockHome` read terms/blocks/
lectures/objectives via existing helpers → user clicks a block → block home
renders → "Continue learning" calls the existing session entry (engine wired in
#2). ⌘K reads the same block list for jump.

## Error handling

- Missing/empty data (no terms yet) → empty states in sidebar + block home, not
  crashes.
- Flag off → legacy `App` renders exactly as today (zero regression).
- Theme toggle persists; defaults to dark.

## Testing

- **Unit:** token mapping (status→class/shape), Badge variant logic, command
  palette fuzzy-filter (pure) — vitest.
- **Visual/manual:** the prototype itself — render the new shell against real
  data, compare to the approved mockups, check dark+light, Compact density,
  keyboard ⌘K.
- **Regression:** flag off → existing app unchanged (build + existing 45 tests
  stay green).

## Out of scope (this sub-project)

- Adaptive learning engine / orchestration logic (#2) — CTA is a placeholder.
- Recognition generation changes (#3).
- Migrating study/quiz/deeplearn/tracker/config views to the new shell — these
  stay on the legacy render until later sub-projects; only sidebar + block home
  are wired now.
- Removing `App.jsx` — it remains the legacy path behind the flag.

## Risks

- **Tailwind in an inline-styled app:** scope Tailwind so it doesn't fight
  existing inline styles (the legacy app doesn't use Tailwind classes; preflight
  could affect globals — use a scoped/prefixed setup or mount new shell in a
  container that opts in). Verify legacy render is visually unchanged with the
  flag off.
- **shadcn + Vite + React 19:** confirm component compatibility; pin versions.
- **Dark mode strategy:** `class` on a root wrapper; ensure both shells don't
  collide on the theme class.
