# SP1 — Strangle the RXTrack monolith into the modular shell
_Round 2 — revised after two Codex adversarial rounds_

## Problem

~60k lines in three files: `App.jsx` (40,142), `Tracker.jsx` (10,543),
`DeepLearn.jsx` (9,144). `App.jsx` holds ~630 hooks; feature components are
prop-driven but coupled through fat prop interfaces backed by App's state +
business logic (`<Tracker>` = ~35 props incl. ~15 callbacks). The shell
(`src/shell/` + `src/engine/`, unit-tested) exists behind `?shell=new` but only
*reads* storage today (`data.js`); writes + change-events are scattered through
`App.jsx`/`Tracker.jsx`/`supabase.js`/modals/`safeSetItem`/`sSet`. localStorage
just overflowed the 5MB quota (interim-fixed, 48e1975).

Goal: run the guided med-teach cycle toward ≥80%/test. SP1 = **restructuring**.

## Locked decisions (grilled 2026-07-25; revised through Codex R2)

1. **Typed per-store modules come first — the real shared store.** `src/stores/*`
   with one module per shared key (e.g. `completionStore`, `lecturesStore`,
   `objectivesStore`), each exposing `read()`, `write(value)` (own codec —
   object-in/serialize-out, plus any merge-before-write the current code does),
   `subscribe(cb)`, backed by a single `notifyStoreChanged(key)` emitter that
   also re-emits `window` `storage`. **No generic raw key/value write.** Phase 0
   inventories and redirects **every shared-key write/delete across the repo**
   (App, Tracker, supabase.js, shell modals, `safeSetItem`/`sSet`, `removeItem`,
   cloud pull/merge) through these modules, and audits/bans shared-key
   `localStorage.getItem` outside `src/stores/*`. Gates everything.
2. **Typed hook seam, async + user-scoped, with a stated conflict policy.**
   Hooks — `useBlocks/useLectures/useObjectives/useWeakConcepts/usePerformance/
   useCompletion/useTracker` — return `{ data, loading, error, mutate }`,
   **scoped by `userId`**, on `useSyncExternalStore` (in-process emitter +
   `window` `storage`; same-tab `storage` doesn't fire, so writers must
   `notifyStoreChanged`). The store contract now specifies, per store:
   **user-scope + auth-switch invalidation**: shared keys are **namespaced by
   userId** (`rxt:<uid>:<key>`) so A→B is deterministic (no cross-user bleed);
   hooks clear/unsubscribe on `userId` change (tested A→B). Plus the
   **merge/conflict policy** (matching current sync's merge semantics +
   oversized-doc guards), so the later Firestore `onSnapshot`
   backing swap preserves conflict behavior and touches no component.
3. **Order: stores → objectives → lecture flow → histology/recognition →
   Tracker LAST.** Store/logic extraction precedes UI; Tracker last after its
   schedule logic is pure.
4. **Flip to default at daily-core parity, including real action paths.** Shell
   default once objectives + per-lecture flow + **Today** + Today's launched
   actions (real objective-quiz start, DeepLearn start, Anki/review logging,
   completion update) work in the shell. **Pure schedule extraction is a hard
   blocker** for Today parity — no "call App's closure" fallback (it's a closure
   in an unmounted component; impossible + violates the invariant). Legacy
   adapters are **excluded from parity credit** and unusable by default-path
   `src/shell/features/*`. Peripherals (HistoStudy, full Tracker, full DeepLearn
   UI) stay on `?shell=old` until ported.
5. **App.jsx stays a working fallback, edited only by the persistence redirect.**
   Its shared-key writes route through the store modules (Phase 0). No UI/logic
   rewrites during SP1; feature code deleted only in teardown after
   default + verified.
6. **Plan gate:** PLAN.md → `/codex-review` → APPROVED → human sign-off → build.

**Exit criterion:** shell default at daily-core parity (incl. action paths).
Full monolith deletion is the tail (SP2).

## Architecture

```
   App.jsx (fallback) ─┐                                  ┌─ src/shell (default)
   Tracker / supabase ─┼─► src/stores/* (per-key modules) ◄┤
   modals / helpers ───┘   read · write(codec+merge) ·     └─ src/shell/features/*
                           subscribe · notifyStoreChanged     (read hooks, call
                           backing: localStorage → Firestore   pure logic; NEVER
                                                               import App/legacy)
                                    ▲
   hooks (useSyncExternalStore): {data,loading,error,mutate}, userId-scoped,
   auth-switch invalidation, per-store conflict policy
                                    ▲
   pure logic (explicit inputs): scheduleLogic(ScheduleContext) ·
   objectives reducers + effectful command handlers · deepLearnLaunch
```

Invariants (ESLint-enforced): (a) `src/shell/features/**` may not import
`src/App.jsx` or legacy top-level feature files (`no-restricted-imports`);
(b) shared-key `localStorage` access only inside `src/stores/*`; (c) every shared
write goes through a store module.

## Work breakdown

### Phase 0 — stores + hook seam (gates everything)
- **T0.1** Repo-wide inventory of shared-key writes/deletes/reads (grep
  `setItem|removeItem|getItem` for `rxt-*`). Output: the key→module map, each
  key **classified shared vs local-preference** — theme / current-shell /
  current-block flags are local prefs (plain localStorage, not store-managed);
  only shared data keys get store modules.
- **T0.2** `src/stores/<key>.js` per shared key: `read/write(value)/subscribe`,
  own codec + any current merge-before-write, `notifyStoreChanged` (+ `window`
  `storage` re-emit). Unit-tested (jsdom), incl. auth-scope + conflict policy.
- **T0.3** Redirect every write/delete site (App, Tracker, supabase.js, modals,
  `safeSetItem`/`sSet`) to the store modules — behavior-preserving. Build + live
  smoke that the existing app is unchanged.
- **T0.4** Hooks in `src/shell/hooks/` via `useSyncExternalStore`, contract
  `{data,loading,error,mutate}` + `userId` scope + auth-change invalidation.
- **T0.5** ESLint `no-restricted-imports` for `src/shell/features/**`; audit
  shared-key `getItem` outside `src/stores/*`. Move the existing legacy
  `PatientRecognition` import behind a bounded legacy-adapter route.

### Phase 1 — Objectives (first UI port, the spine)
- **T1.1** Extract objectives logic: **pure reducers** (coverage %, bloom
  rollups, alignment, status/assign/rename/delete transforms) **+ effectful
  command handlers** (re-extract = AI/network; rename touching lecture meta;
  quiz-launch) with tested write-sets. `src/shell/logic/objectives.js`; no App
  import.
- **T1.2** Split `ObjectiveTracker` → read-only view (reads
  `useObjectives/useWeakConcepts/usePerformance/useCompletion`) + action
  adapters (call command handlers + store `mutate`).
- **T1.3** Route under `src/shell/features/objectives/`. Live-verify view + each
  real action, including the **real objective-quiz launch contract** (nav/event
  path), not a stub.

### Phase 2 — Per-lecture study flow
- **T2.1** Sequence in-shell pieces (LectureExtract → atoms →
  AtomQuiz/Calibration) into one per-lecture flow on hooks.
- **T2.2** Objectives↔atoms tagging surfaced (feeds SP2). Live-verify.

### Phase 3 — Histology / Patient Recognition
- **T3.1** Port `HistoStudy`/`PatientRecognition` into `src/shell/features/*` on
  hooks; retire the legacy-adapter import. Live-verify.

### Phase 4 — Today + Tracker (LAST)
- **T4.1** **Fixture harness first:** capture current `generateDailySchedule` /
  `buildStudySchedule` inputs+outputs from App in-browser into fixtures. This is
  the ONE sanctioned temporary exception to "App edited only by the persistence
  redirect": a **dev-flag-gated, test-only fixture probe** in App (no production
  code path), **removed once fixtures are captured**.
- **T4.2** Extract both into pure `src/shell/logic/schedule.js` over an explicit
  `ScheduleContext = { terms, blocks, lectures, objectives, performance,
  completion, reviewedLectures, examDates, weakConcepts, blockMeta,
  studyModeByLecture, now }` — **`blockMeta` is resolved data** (or a pure,
  unit-tested imported resolver), never an App-provided function, so no App
  closure leaks into the "pure" module. Assert against the fixtures (hard
  blocker for Today parity/flip).
- **T4.3** Shell **Today** on hooks + schedule logic + real action paths:
  objective-quiz start, **a minimal shell DeepLearn-launch adapter** (full
  DeepLearn UI stays peripheral), Anki/review logging, completion update. This
  is the flip trigger.
- **T4.4** Port fuller Tracker surface as needed.

### Flip & teardown
- **T5.1** Replace `main.jsx` persisted `rxt-new-shell` opt-in with an explicit
  resolver, precedence exactly: **query-param override → remote flag → local
  flag → default** (remote-over-local when they disagree); rollback disables the
  persisted shell selection (no sticky bad state). Shell nav reactive via hooks.
- **T6.1 (tail)** After default + verified, delete ported feature code from
  `App.jsx`/`Tracker.jsx` in reviewable chunks; retire `?shell=old` when empty.

## Testing & safety

- Store modules + pure logic unit-tested before their UI ports; schedule
  extraction guarded by the T4.1 fixtures (captured from real App output).
- Auth-switch (user A→B) tested for store scoping/invalidation.
- Every UI port live-verified in the browser (billing on; AI + Firestore work).
- `App.jsx` only edited by the Phase-0 persistence redirect, the T4.1 dev-only
  fixture probe (removed after capture), and teardown.
- No dual-write divergence: all shared writes via store modules; hooks reactive.
- Data-layer behavior unchanged during SP1; Firestore-authoritative swap is a
  later step behind the same store + hook + conflict-policy contracts.

## Out of scope for SP1

- Firestore-authoritative migration (backing swap behind the contract).
- SP2 (connecting tools into the guided cycle / orchestrator behavior).
- Wholesale `App.jsx` deletion up front; objectives 1.9MB trim (with data layer).

## Open questions (resolved)

- Reactivity: `useSyncExternalStore` + emitter + `window` `storage`; writers
  `notifyStoreChanged`.
- Flip threshold: daily-core parity includes real Today action paths; schedule
  extraction is a hard blocker (no App-closure fallback).
- Extraction feasibility: fixture-capture harness first, then assert pure fns —
  if a fn resists purification it blocks the flip rather than coupling to App.
