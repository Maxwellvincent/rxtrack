# Adaptive Learning Engine — Design

**Date:** 2026-06-19
**Status:** Approved (design), pending spec review
**Branch:** `app-rework`
**Builds on:** design-system+shell (#1), recognition generation (#3), the
recognition bank, and the existing mastery/weak-concept tracking.

## Where this fits

Sub-project #2 of the RXTrack redesign — the core. It powers the single
**▸ Continue learning** entry the shell already renders as a placeholder. One
adaptive session orchestrates teaching, recognition, and testing driven by the
learner's mastery, so the user stops choosing modes and just learns.

## Goal

A fixed-burst (~10-item) adaptive session that, for each item, picks a concept
(weak-first) and presents it in the mode its mastery calls for —
**Teach / Recognize / Test** — sourced from the recognition bank, tutored by
Claude, feeding results back into the existing mastery model. Runs in the new
shell, engine-driven, with a ⌘K override.

## Decisions (from brainstorming)

- **Session shape:** fixed burst, default **10 items**, with an end **summary**
  (items done, mastery changes, weak areas remaining). Not endless.
- **Selection:** **weak-first** — struggling/developing concepts prioritized
  (weighted by `missCount` + exam proximity); a **new** concept enters only when
  the weak backlog is light.
- **Mode policy (mastery → mode):** `struggling → Teach`, `developing →
  Recognize`, `mastered → Test`. A miss on any mode drops the concept back toward
  Teach next time (via existing `recordWrongAnswer`).
- **One content type, three presentations:** a `recognition_items` row already
  holds `vignette / leadIn / correctDiagnosis / mechanism / keyDifferentiator /
  options[]`. Teach leads with mechanism then the case; Recognize is the current
  vignette→diagnosis→reveal; Test is vignette→answer→score with minimal teaching.
- **Tutor model:** Claude when `ANTHROPIC_API_KEY` set, else Gemini (via existing
  `aiClient`). "Teach me deeper" is a live call.
- **Engine-driven (auto):** user hits Continue; engine decides each item. ⌘K
  override ("quiz me", "just recognition") remains.

## State model (reused, not reinvented)

Per-concept mastery lives in `localStorage["rxt-weak-concepts"]` per block:
`{ concept, masteryLevel: "struggling"|"developing"|"mastered",
consecutiveCorrect, missCount, totalAttempts, lastCorrect, blockId, ... }`.
`masteryLevel` is derived from `consecutiveCorrect` (≥4 mastered, ≥2 developing,
else struggling). The engine reads these and writes results through the existing
update paths (the same functions App.jsx uses), so legacy and engine stay
consistent.

## Architecture

New isolated module `src/engine/` (pure logic separated from React views):

- `src/engine/selectConcept.js` — **pure.** `selectNext(concepts, opts)` →
  `{ concept, mode }`. Implements weak-first priority + mastery→mode mapping +
  new-concept-when-backlog-light. Inputs are plain objects; no I/O. Unit-tested.
- `src/engine/session.js` — **pure-ish.** `createSession({ size })` and
  `advance(state, answer)` → next state; tracks burst progress, per-item
  outcomes, and the end-of-burst summary. Unit-tested on the reducer logic.
- `src/engine/content.js` — fetch/choose a `recognition_items` row for a concept
  (reuse `fetchRecognitionItems` + `pickWeightedItems`); if none, trigger a
  small `buildBlockBank` batch or fall back to live `aiClient` generation.
- `src/engine/masteryStore.js` — read `rxt-weak-concepts`; record an answer
  (correct → advance consecutiveCorrect; wrong → existing `recordWrongAnswer`
  semantics). Self-contained localStorage access, mirroring App.jsx's writes.
- `src/engine/EngineSession.jsx` — the session view: renders the current item in
  its mode (Teach/Recognize/Test sub-views), handles answer → feedback → advance,
  shows the burst progress + final summary. Lives in the shell.
- Wire `Shell.jsx` "Continue learning" → mount `EngineSession` for the active
  block (replacing the `alert` placeholder).

**Isolation:** selection and session reducers are pure and testable without
React or the DOM; content + mastery I/O are thin adapters; the view composes
them. Each unit has one job.

## Data flow

Continue → `EngineSession(blockId)` → read concepts (`masteryStore`) →
`selectNext` → `content` fetches a bank item → render mode sub-view → user answers
→ record result (`masteryStore`) → `advance` → next item until burst size → summary.

## Modes (presentation of one bank item)

- **Teach:** show `mechanism` + `keyDifferentiator` first ("here's why…"), then the
  vignette as an illustration; "Teach me deeper" → live Claude. Counts as exposure,
  not a graded miss.
- **Recognize:** `vignette` → pick diagnosis from `options` → reveal mechanism +
  distractor rationale (current PatientRecognition behavior). Graded.
- **Test:** `vignette` → answer → score; reveal only correctness + one-line why.
  Graded, retrieval-focused.

## Error handling

- No concepts for a block (fresh) → seed from objectives/bank subjects as
  "new/struggling" so the session can still teach.
- No bank item for a concept → kick a small `buildBlockBank` batch; if still none,
  fall back to live `aiClient` generation for that item; never blank.
- AI/network failure mid-item → show a retry, don't lose burst progress.
- Engine runs only in the new shell (`?shell=new`); legacy app untouched.

## Testing

- **Unit (vitest, node):** `selectNext` (weak-first ordering, mastery→mode,
  new-when-light), `session` reducer (burst length, outcome tracking, summary),
  mastery record (advance vs reset). Pure — fully testable.
- **Manual/visual:** run a burst in `?shell=new`, verify mode shifts as mastery
  changes, weak-first ordering, summary.

## Out of scope

- Migrating other legacy views to the shell.
- Image-based recognition (Proper Learning+).
- Changing the recognition generation (#3, already done) beyond calling it.
- Multi-user auth hardening of the Edge Function (tracked follow-up).
