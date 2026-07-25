# Plan Review Log: SP1 — strangle the monolith into the shell

Started session (2026-07-25). MAX_ROUNDS=5. Model: Codex CLI default. Read-only every round.

## Round 1 — Codex (VERDICT: REVISE)

14 findings, verbatim summary:
1. Shell.jsx:15 already imports legacy PatientRecognition — coupling before Phase 3.
2. "Data layer = shared store" false today: data.js is read-only; writes scattered in App/Tracker. Need a real store (read/write/subscribe/emit) before porting.
3. Reactivity via rxt-*-updated incomplete; multiple event names; Shell memoizes blocks once. Use useSyncExternalStore + one notifyStoreChanged(key).
4. CustomEvents don't cross tabs; storage event doesn't fire same-tab. Hooks must listen to both in-process event + window.storage.
5. generateDailySchedule not cleanly extractable — closes over terms/lectures/getBlockObjectives/getLecPerf/reviewedLectures + reads rxt-completion (App.jsx:21053/21059/21143). Make pure fn with explicit store args.
6. buildStudySchedule hidden deps (examDates/getBlockLecs/resolveBlockMeta/getBlockObjectives/performanceHistory/detectStudyMode, App.jsx:20890). Extract pure loop via normalized ScheduleContext + snapshot tests.
7. "App not edited" conflicts with "both shells share data layer" — App can't share the seam unless its writes route through it.
8. ObjectiveTracker not "mostly display": mutation/quiz/assign/delete/re-extract/rename callbacks (ObjectiveTracker.jsx:664/840/1423). Split into read-view + action adapters.
9. ObjectiveTracker reads rxt-weak-concepts directly (705) — porting only useObjectives misses data. Add hooks for every store it reads.
10. daily-core-parity flip too low: Today needs schedule gen, completion, performance, reviewed, quiz launch, DeepLearn launch, Anki backlog. Require action-path parity too.
11. Dual-write divergence — Shell.jsx:85 computes blocks once; shell edits won't refresh nav without reload. Make nav reactive.
12. Firestore swap oversold — hook contract should be {data,loading,error,mutate} + user-scoped NOW even if localStorage-backed.
13. main.jsx:9 persists rxt-new-shell=1; conflicts with keep ?shell=old — users stuck in new shell. Explicit rollback-able resolver.
14. Simpler alt: extract data access FIRST (src/stores/* typed accessors+subscriptions; route App+Tracker through them), THEN port leaf UI.

### Claude's response — ACCEPT ~all; key revisions
- ACCEPT 14 (reorder): Phase 0 becomes a real STORE (`src/stores/`) with read/write/subscribe/notify, built + App/Tracker persistence routed through it, BEFORE any UI port. Supersedes "read-only hooks first".
- ACCEPT 2,7,11: the shared store is only real once writes emit through it. Revise decision #5: App stays intact EXCEPT a mechanical, behavior-preserving persistence redirect (localStorage.setItem → store.set which setItem + emits). Low-risk; also fixes the fallback's own event consistency.
- ACCEPT 3,4: hooks use useSyncExternalStore, subscribe to in-process store event + window.storage (cross-tab).
- ACCEPT 12: hook contract = {data, loading, error, mutate}, user-scoped, from day 1 → seamless Firestore onSnapshot swap.
- ACCEPT 5,6: extract generateDailySchedule/buildStudySchedule as PURE fns taking an explicit ScheduleContext; snapshot-test against current App output before wiring.
- ACCEPT 8,9: split ObjectiveTracker into read-view + action adapters; add hooks for every store it reads (objectives, weak-concepts, performance, completion, quiz-status, lectures).
- ACCEPT 10: raise flip threshold — "daily-core parity" now = Today view + its action paths (objective-quiz launch, DeepLearn launch, Anki/review logging, completion update) working in shell. Still below FULL parity (HistoStudy/DeepLearn-full via ?shell=old).
- ACCEPT 1: ban shell imports of legacy feature components except behind an explicit legacy-adapter route; ported components live in src/shell/features/*.
- ACCEPT 13: replace persisted rxt-new-shell opt-in with an explicit, rollback-able default resolver.
- Rejected: none material. Order of UI ports (objectives→…→Tracker) kept, now PREFIXED by the store phase.

## Round 2 — Codex (VERDICT: REVISE)

14 findings (accepted all — refinements, no rejections):
1. Redirect must cover ALL shared-key writes repo-wide (supabase.js, shell modals, safeSetItem/sSet, removeItem, cloud pull/merge), not just App/Tracker setItem.
2. Generic store.write(key,val) underspecified (strings vs objects vs merge-before-write) → typed per-store modules/codecs (completionStore.write(obj)).
3. Audit + lint shared-key getItem outside src/stores/*.
4. Escape-hatch ("keep in App, shell adapter") violates no-App-coupling + impossible (closure in unmounted App) → pure schedule extraction is a HARD BLOCKER for Today parity/flip.
5. Snapshot "vs current App output" not actionable on private closures → build a fixture-capture harness in-browser FIRST, then assert extracted fn vs fixtures.
6. ScheduleContext missing deps → add blocks, resolveBlockMeta output, reviewedLectures, studyModeByLecture, injected now (clock/tz).
7. "actions = pure reducers" false for re-extract(AI/net)/quiz-launch/rename/delete/assign → pure reducers + effectful command handlers with tested write-sets.
8. Quiz-launch stub too weak → require real launch contract + nav/event path before objectives count as ported.
9. Today must START DeepLearn in shell though full DeepLearn stays peripheral → minimal shell DeepLearn-launch adapter (blocker before flip).
10. Legacy adapters excluded from parity credit; not usable by default-path features.
11. "Ban via note" unenforceable → ESLint no-restricted-imports on src/shell/features/** vs App.jsx + legacy feature files.
12. Hook contract needs auth-switch semantics → include userId in scope, clear/unsubscribe on auth change, test A→B.
13. Firestore swap oversimplified (merge semantics, oversized-doc guards, cache hydration) → define per-store merge/conflict policy in the store contract NOW.
14. Default resolver underspecified → exact precedence: query-param override > remote/local flag > default; rollback disables persisted shell selection.

### Claude's response — ACCEPT all 14; revise PLAN
No rejections; all sharpen correctness. Key: remove the schedule escape-hatch (extraction now a hard flip blocker); Phase 0 = repo-wide write inventory + typed per-store codecs + ESLint no-restricted-imports + shared-key getItem audit; add fixture-capture harness before schedule extraction; expand ScheduleContext; objectives actions = pure reducers + effectful command handlers with real launch contracts (incl. shell DeepLearn-launch adapter); store contract now specifies user-scope + auth-switch invalidation + per-store merge/conflict policy; resolver precedence spelled out.

## Round 3 — Codex (VERDICT: REVISE — "sound enough once 2 material patched")

Material blockers (2):
1. T4.1 fixture harness conflicts with "App only edited by persistence redirect" — schedule fns are private closures; capture needs dev-only instrumentation. Fix: explicitly allow a TEMPORARY test-only fixture probe in App, removed after capture, no prod behavior change.
2. ScheduleContext passes resolveBlockMeta as a FUNCTION → smuggles App closure back into "pure" extraction. Fix: pass RESOLVED block metadata (data) or a pure imported resolver with tests, not an App-provided fn.

Polish (3):
3. Store inventory should classify shared vs local-preference keys (theme/current-shell/current-block).
4. Auth-scoped localStorage needs a concrete policy (namespace keys / clear on switch / pull-replace) — pick one.
5. Resolver: define remote-vs-local flag winner explicitly.

### Claude's response — ACCEPT all 5
1. Add explicit exception: temporary test-only schedule fixture probe in App (behind a dev flag), removed after fixtures captured; no production path change.
2. ScheduleContext.resolveBlockMeta → replace with resolved `blockMeta` data (or a pure imported resolver, unit-tested); no App-provided functions in the context.
3. T0.1 key map gains a shared-vs-local-preference classification (theme/shell/current-block = local prefs, not shared-store-managed).
4. Auth policy = namespace shared keys by userId (`rxt:<uid>:<key>`) OR clear-on-switch; pick namespacing for deterministic A→B; state in store contract.
5. Resolver precedence: query-param override > remote flag > local flag > default (remote-over-local).

## Round 4 — Codex (VERDICT: APPROVED)

"No material blockers remain. Store-first, repo-wide persistence redirect, enforceable shell import boundary, pure schedule extraction as a flip blocker, real Today action-path parity, rollback-able shell defaulting." One trivial consistency polish: safety bullet should mention the T4.1 dev-only fixture-probe exception. → Patched.

CONVERGED in 4 rounds. Plan sound enough to implement.

## Act 3 — Build (Codex writes, Claude verifies)

### Round 1 — Codex build (Phase 0 foundation: T0.1/T0.2/T0.4/T0.5, T0.3 deferred)
Built src/stores/ (base.js namespacing+merge+notify+storage-bridge, merge.js extracted sync semantics, 8 store modules: terms/lectures/blockObjectives/weakConcepts/performance/completion/examDates/calibration) + src/shell/hooks/ (useStoreResource on useSyncExternalStore, currentUser scope, 8 hooks) + store tests. Report file came back empty (Codex -o didn't capture); verified from diff.

### Claude's verdict — ACCEPT with fixes
- Quality: HIGH + spec-faithful. base.js = rxt:<uid>:<key> namespacing + legacy read-through fallback + cross-tab window-storage bridge + in-process notify. useStoreResource = stable JSON snapshot + {data,loading,error,mutate}. Stores document conflict policy + reuse real merge semantics.
- Proof: `npm run build` ✓. New store/hook tests pass. Full suite 164 pass; only pre-existing authAdapter/firestoreAdapter (Firebase-network) fail — unrelated.
- BUG FIXED by Claude: useTerms.test.js used JSX in a .js file → Rollup parse error. Renamed → .jsx. Now parses/passes.
- DEVIATIONS (Codex skipped; Claude completed): (1) T0.1 docs/sp1/store-inventory.md written from a repo audit — the T0.3 redirect work order; (2) T0.5 ESLint no-restricted-imports for src/shell/features/** vs App.jsx + legacy components; (3) src/shell/features/README.md placeholder.
- lint clean, build clean after additions.
- NOT done (as scoped): T0.3 write-redirect (next build), legacy-adapter move. App.jsx/Tracker.jsx untouched this build (invariant held).

## Act 3 — Build (SP1 T0.3)

### Round 1 — Codex build: ABORTED (tooling unavailable)
`codex exec` started thread `019f9aeb-a08f-7580-a176-eacbd7b19d3f`, returned zero
model output in 17s, `task_complete` with `last_agent_message: null`, and wrote
no report and no diff. Probe run surfaced the cause:

```
ERROR: You've hit your usage limit. To continue using Codex and get access to
GPT-5.3-Codex, start a free trial of Plus today, or try again at Aug 6th, 2026 11:54 AM.
```

Codex CLI (0.142.5, ChatGPT-account auth) is unusable until 2026-08-06. Per the
project rule "if a model CLI is unavailable, say so and fall back to normal
implementation", Claude implemented `docs/sp1/T0.3-spec.md` directly.

### Round 1 — Claude build + self-verify
Spec-fidelity notes:
- §2 store API split landed first; `write()` = authoritative replace,
  `merge()` = conflict policy. 22 new tests in `src/stores/replaceSemantics.test.js`
  prove a removed entry stays removed for all 10 modules.
- §3 redirects went through `safeSetItem` (App), `sSet` (Tracker) and a new
  `persistLocal` (supabase.js), plus direct store calls in 6 leaf modules.
- Three in-scope writes hid behind key constants and were NOT in the T0.1
  inventory: `src/calibration.js` (`STORAGE_KEY`), `src/engine/masteryStore.js`
  (`KEY` = `rxt-weak-concepts`), `src/ankiConnect.js` (`OBJ_KEY` =
  `rxt-block-objectives`). All three redirected.
- Two dynamic-key writes also redirected: App's import/restore branch and
  supabase's `pullUserKvFromSupabase`.

Self-review caught one regression in the first cut: routing store keys early in
`safeSetItem` skipped its QuotaExceededError cache-clear-and-retry path — the
key that actually blows quota is `rxt-lec-meta`. Refactored into `persistItem`
so the store path is inside the same try/catch and keeps the recovery.

### Claude's verdict — PASS
- `npm test`: 186 passed, 17 skipped. The 2 failing suites (`authAdapter`,
  `firestoreAdapter`) fail identically on clean HEAD — they need the Firebase
  emulator/network. Pre-existing, not caused by this change.
- `npm run build`: green (14.8s).
- `npx eslint src/App.jsx`: 4 problems, byte-identical to clean HEAD.
- Spec §7 grep: no production rows remain; only `src/firestoreAdapter.test.js`
  (test fixture) touches an in-scope key directly.
- NOT yet done: live browser smoke that the running app is unchanged.
