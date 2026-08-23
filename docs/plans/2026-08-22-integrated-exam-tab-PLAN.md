# Plan: RXTrack Integrated Exam tab
_Round 7 (user-requested extra rounds beyond original MAX_ROUNDS=5) —
revised after Codex rounds 1-7 (see PLAN-REVIEW-LOG). Needs human sign-off
before build._

## Goal

Add a new top-level "Exam" tab to RXTrack (`src/shell/`) that runs block-wide,
cross-lecture, timed mini-exams matching real Esoft/IMCQ exam conditions, plus
a practice variant, with a per-lecture performance dashboard that feeds
existing weak-concept/urgency scheduling. Full background/decisions/reuse
inventory: `docs/plans/2026-08-22-integrated-exam-tab.md` (companion doc,
read this too).

## Approach

1. New feature directory `src/shell/features/exam/`, following the
   `objectives`/`lectures` feature-folder convention (container component,
   config modal, launch logic module, controller hook, tests alongside).
2. **Question bank metadata**: do **not** change `questionBanksStore`'s
   existing shape (`readExemplars`, `flattenQuestionBanks`, DeepLearn, and
   the bank management UI all expect `{filename: Question[]}` — changing it
   breaks every existing consumer). Instead add a sibling store,
   `src/stores/questionBankMeta.js`, `{[bankId]: {filename, blockId,
   uploadedAt}}`, populated at the `saveBank` call site when a bank is
   uploaded. "Most recent real-exam upload" in config defaults = newest meta
   entry with matching `blockId`, then read that bank's content from the
   existing store by filename. **Single-owner-per-filename**: if an upload's
   filename already has a meta entry for a *different* `blockId`, the new
   upload becomes that filename's sole current owner (the underlying content
   store is genuinely shared/flat by filename — this is a real constraint of
   that existing store, not something worked around here without a bigger
   content-keying migration, which stays out of scope). **Stale-entry
   skip**: lookup skips any meta entry whose filename no longer exists in the
   bank store, falls through to the next-newest, then the static default —
   never returns an unusable reference.
3. **Exemplars scoped to block**: add a block-filtered variant of
   `readExemplars()` (it currently flattens every stored bank across all
   blocks — cross-block leak). Documented fallback (static few-shot examples)
   when the active block has no bank yet.
4. Launch config modal: pick format (A = exam conditions, B = practice),
   question count (defaults from step 2's lookup, else static fallback —
   fallback number: 20), duration (**required when Format A is selected**;
   Format B is untimed — no countdown renders, source PDFs carry no timing
   data to seed one anyway). **Feasibility gate before launch is enabled**: compute the
   eligible question pool across the block's lectures; if it can't fill the
   requested count, show which lectures/objectives were excluded and why,
   and cap the launchable count rather than silently returning fewer
   questions than promised. Launch is disabled outright if zero lectures have
   a usable objective source.
5. **Cross-lecture allocation policy** (explicit, not implied): minimum
   coverage first — every eligible lecture contributes at least 1 question if
   the requested count allows it — then remaining slots filled by weighted
   sampling. Weight formula: `severity * 0.6 + objectiveCountNorm * 0.4`,
   where `severity = min(nonMasteredWeakConceptCount for lecture, 5) / 5`
   (count from `weakConceptsForLecture`, capped and normalized 0-1 —
   `weakConceptsForLecture` returns an array of records, not a scalar, so
   this count-and-cap is the actual scalar used) and `objectiveCountNorm =
   objectiveCount / maxEligibleObjectiveCount` (denominator = the max
   objective count across the block's eligible lectures for this launch;
   zero objective count maps to zero — both left undefined in round 5,
   fixed in round 6). Seed = `sessionId` (deterministic PRNG, not
   `Math.random()` — reproducible/testable). Tie-break: lectureId lexical
   order.
6. **Question generation & provenance**: generate **per-lecture batches**,
   not one LLM call per question — one call per lecture requesting that
   lecture's full allocation, via `src/llmBridge.js` (bridge-first, cloud
   fallback, matching every other generation path in this repo), using the
   block-filtered exemplars (step 3) and that lecture's `resolveDefaultDifficulty`
   baseline directly — **no `roundDifficulty` layer**; there is no
   per-lecture "round" concept in a cross-lecture exam, so applying both
   functions was undefined behavior in round 0 of this plan. Every generated
   question is stamped at creation time with a stable `questionId`, immutable
   `blockId`, `lectureId`, and source objective IDs — answers, CAS merge
   (step 13), tutor caching (step 19), and finalization markers all key off
   `questionId`, never array position or stem text. Fuzzy matching
   (`matchTextToCandidates`) stays reserved for untagged/imported data (e.g.
   score-report parsing) — it is never used to attribute a question this
   feature itself generated. **Choices are constrained to plain text in the
   generation prompt** — `AtomQuiz.jsx:204` renders a choice's text directly
   as a React child and throws on a table-shaped object; exemplars may
   include table-shaped choices but every exam-tab question is freshly
   generated (never a directly-reused parsed bank question), so the prompt
   avoids producing that shape rather than building a new renderer for it.
   Prompt compliance alone isn't enforced, though — `normalizeQuestions`
   accepts object-valued choices, so a model ignoring the instruction would
   still produce a validated, renderer-crashing question. Exam-specific
   validation independently rejects any question with a non-string choice
   value before launch, regardless of prompt compliance. If a
   batch validates short (malformed questions excluded per step 11), retry
   that lecture's shortfall up to 2 additional attempts; if still short,
   abort launch before the timer starts rather than starting with fewer than
   the confirmed count.
7. **Question set completes before the timer starts.** Format A promises all
   questions up front; the controller must finish and validate generation for
   every slot, and only then set `startedAt`/the deadline. No timer runs
   concurrently with generation.
8. One session controller with a `format` flag rather than two parallel
   trees — format A renders all validated questions up front behind a hard
   countdown; format B renders one question at a time with immediate
   reveal/explanation (same UX family as today's per-lecture Quiz mode). Both
   draw the same allocated question set + scoring path.
9. **Timer**: persist an absolute wall-clock deadline (`startedAt +
   durationMs`), never an interval-tick counter — background throttling,
   sleep, or reload can't grant free time this way. While the page stays
   open, remaining time is derived from monotonic elapsed time
   (`performance.now()`) rather than wall clock, so a backward system-clock
   change during a running session can't extend it. Reconciled on
   visibility/focus/mount. A restored session past its deadline auto-submits
   immediately on reconciliation. **Accepted residual risk**: immediately
   after a reload there's no monotonic baseline yet, so remaining time is
   computed from the wall-clock deadline for that one instant — a clock
   rollback timed exactly around a reload could still extend a session.
   Low-stakes (self-inflicted, against one's own practice exam); not solved
   further.
10. **Submission is an idempotent state transition**, enforced as a
    Firestore transaction with an `in_progress`-only precondition on the
    session doc (not just an in-memory flag — must survive reload, cross-tab,
    and cross-device using the same session ID). Covers timer-fire, manual
    submit, and unmount racing each other.
11. **Scoring rules, defined explicitly**: unanswered = incorrect. Any
    late click after the deadline is rejected (answers lock at expiry, not
    at render). Malformed/table-shaped choices reuse the existing
    `examParser`/`mcq.js` validation already in the pipeline — a question
    that fails validation is excluded from the pool at generation time (see
    step 6's retry/abort), never scored as present-but-broken.
12. **Answer content is not rendered pre-submission** in Format A (choices
    render, `correct`/`explanation` fields stay unrendered until the review
    screen) — prevents accidental self-spoiling from a stray render. This is
    a UI-gating decision, not a security boundary: no server-side answer-key
    split (single-user local study tool, no proctoring threat model — see log
    round 1, rejected item #16).
13. **Session persistence**: new Firestore collection
    `/users/{uid}/examSessions/{sessionId}` (needs a rule added to
    `firestore.rules` — owner-scoped, same pattern as the existing
    `dlSessions` match block), one **mutable** document per session (autosave
    and status updates land on the same doc — "immutable" was wrong framing
    in round 1). Versioned schema:
    `{schemaVersion, sessionId, blockId, lectureIds, format, status:
    "in_progress"|"finalizing"|"submitted"|"abandoned", questions:
    [...snapshot...], answers: [{questionId, value, answeredAt, seq,
    writerId}], sideEffectsCompleted: {statsRecordedQuestionIds: string[],
    weakConceptsRecorded: boolean}, startedAt,
    deadline, submittedAt, rev, updatedAt}`. Max 50 questions per session
    (Firestore 1 MiB document cap) — enforced as a launch-time validation,
    not just a config-modal suggestion; session write is size-checked before
    commit, errors rather than silently truncating. Concurrent autosaves use
    compare-and-set against `rev`; on a `rev` conflict, reread the current
    doc and merge answers by `questionId` (step 6), ordered by each answer's
    `answeredAt` (client timestamp), monotonic per-writer `seq` as tie-break
    if timestamps collide, and a stable `writerId` (per-tab/session
    identifier, lexical compare) as final tie-break — `seq` alone is only
    monotonic within one writer, so two different tabs could otherwise
    produce an identical `answeredAt`+`seq` pair for the same question with
    no deterministic winner. Last-write-wins per-question by that full
    ordering, not per-document, so two tabs answering different questions
    merge cleanly.
    Autosave writes require `status === "in_progress"` in the same
    transaction — rejected once `finalizing`/`submitted`/`abandoned`, so a
    stale tab can't mutate frozen answers while finalization is running. No
    single-active-editor lock (too restrictive for an accidental second
    tab). A dedicated write function for this
    collection returns the underlying Firestore write promise — does
    **not** reuse `writeCloud`'s fire-and-forget shape (`writeCloud` only
    `console.warn`s on failure and returns synchronously; insufficient for
    step 20's sync-status UI). `blockId` and lecture provenance are
    snapshotted into the session at creation — navigating to a different
    block mid-session does not affect an in-flight session's
    scoring/display.
14. **Submission is a resumable finalization, not a single flag flip.**
    After the `in_progress`-only transaction locks the session
    (`status: "finalizing"`), two deterministic side effects run, each
    tracked by its own completion marker on the session doc —
    `sideEffectsCompleted: {statsRecorded, weakConceptsRecorded}`:
    - `statsRecorded`: calls the existing `recordAnswer(userId, lectureId,
      wasCorrect)` (`src/stores/lectureQuestionStats.js`) once per question,
      iterating the session's final answers. No new "canonical event
      pipeline" is built — `recordAnswer` is already a non-idempotent
      whole-document read-modify-write with no event ID, shared by
      objectives quizzes today; that race (two tabs hitting the same
      aggregate doc) already exists and isn't introduced by this feature.
      Fixing that store's concurrency model is store-layer work matching
      SP1's own mandate, out of scope here. **The marker itself must be
      awaited, and the write must not swallow its own failure**:
      `recordAnswer` internally calls `writeCloud`, whose promise is already
      `.catch(console.warn)`'d (`src/stores/cloudBase.js:212`) — a caught
      promise *resolves*, so a naive awaitable sibling that just returns
      that same promise would still report success after a genuinely failed
      write (a real gap caught in round 6, not a restatement of an
      already-accepted risk). Add a purely-additive awaitable sibling (used
      only by exam finalization) that does **not** swallow rejection — it
      returns/rethrows the uncaught write promise, so a rejected write
      actually rejects the awaiter and the marker is never set. Changes
      nothing for `writeCloud`'s or `recordAnswer`'s existing
      callers/behavior — only exposes a promise that already exists
      internally today, without discarding the failure case. **Completion
      is tracked per `questionId`**, not one boolean for the whole batch —
      up to 50 `recordAnswer` calls per session means a whole-batch boolean
      would let a crash-after-49-of-50 retry re-run all 50 on resume
      (round 5's "at most one extra increment" claim was wrong and is
      retracted); per-question tracking bounds a resume to only the
      genuinely-unrecorded questions. **Accepted residual risk, still
      present, honestly bounded not falsely bounded**: the per-question
      marker write (`statsRecordedQuestionIds`) is itself separate from the
      `recordAnswer` write it guards, so full exactly-once across two
      independent writes per question isn't built — needs a transaction
      spanning both, out of scope. Once a question's ID is in
      `statsRecordedQuestionIds`, it never re-increments. But if that
      marker write specifically (not the `recordAnswer` write) keeps
      failing while the data write keeps succeeding, each reconciliation
      attempt re-increments that one question — bounded by reconciliation
      attempt count, not a fixed "at most once" (round 5 and 6 both claimed
      a fixed bound here; round 7 caught that this was still false, and
      it's retracted for good). Rare in practice (needs the marker write
      specifically, repeatedly, to be the failing half), and still bounded
      to only ever perturbing `lectureQuestionStats`, the
      adaptive-difficulty input — never the exam's own scoring or
      dashboard, both of which read directly from `examSessions` and are
      unaffected.
    - `weakConceptsRecorded`: same non-swallowing-awaitable treatment. The
      write path in step 15 is a pure function of queryable session data
      (not an increment, so a replay produces the identical value),
      persisted through an equivalent awaitable, non-swallowing sibling of
      the weak-concepts store's write function; the marker is set only
      after that write's promise resolves, not merely after the
      fire-and-forget call returns.
    `status` only flips to `submitted` once **both** markers are true.
    Any reconciliation read (reload, focus) that finds a session stuck in
    `finalizing` resumes from whichever markers are still false — each
    marker guards its side effect from re-running, so resuming is
    idempotent, not a blind retry. The UI's "results saved" confirmation
    means session-doc durability only (that's what's actually guaranteed
    synchronously); derived-stat/urgency sync status is separate (step 20).
15. **Exam-miss → weak-concept write path, with recovery**: dashboard and
    this path share one source — every `submitted` session for the block
    plus the session currently being finalized (its answers are already
    frozen at this point — excluding it would omit its own contribution
    from its own calculation), grouped by lecture (step 18), deduplicated by
    session ID. Two separate signals, each a pure function of that queried
    data (not an incremented counter — replay-safe, see step 14):
    - **Initial flagging** uses lifetime-**cumulative** miss-rate across all
      those sessions for the lecture — deliberately sticky-until-addressed.
      Minimum 3 cumulative questions to count at all (minimum-coverage
      allocation, step 5, can give a lecture just 1 question per exam, so a
      single session alone may never reach 3 — cumulative still gets there
      over multiple exams). Crossing miss-rate ≥ 40% writes/bumps
      `exam:<blockId>:<lectureId>` to `masteryLevel: "struggling"` with
      updated `missCount`/`lastMissed`.
    - **Recovery** uses a **per-session** streak instead of the cumulative
      figure (cumulative alone can't represent "recent improvement" — a
      lifetime-bad lecture would never recover, and old poor results would
      block recovery indefinitely even after real improvement). Each
      individual submitted session where that lecture's miss-rate in *that
      session* is < 40% counts as one clean session; `consecutiveCleanSessions`
      tracks the count, resetting to 0 on any non-clean session.
    - **Precedence, single decision order, as a pure lookup — not an
      increment from stored state**: `masteryLevel` is computed directly
      from `consecutiveCleanSessions` each time, never by "stepping" the
      currently-stored level (stepping-from-current would let a replay
      after a marker failure advance mastery twice — caught in round 6).
      0-1 clean sessions → level driven by cumulative miss-rate
      (`"struggling"` if crossing threshold, else unchanged); 2-3 clean →
      `"developing"`; 4+ clean → `"mastered"` (real enum values, verified
      against `src/shell/features/tracker/weakConcepts.js`). Replaying
      identical session history always produces the identical level.
      Cumulative miss-rate is not separately consulted once
      `consecutiveCleanSessions ≥ 2` — recent performance always outranks
      lifetime history once a streak is established, and `consecutiveCorrect`/
      `lastCorrect` update alongside the looked-up level.
    Both directions compute a replacement entry, then pass it through the
    existing `mergeExamReportConcepts`
    (`src/shell/logic/examReportWeakConcepts.js`) for its merge-by-id/
    replace semantics — no `recordOutcome` (`src/engine/mastery.js`)
    involved; that function operates on a different concept shape and
    doesn't fit this store, a claim in an earlier round of this plan that
    was checked and was wrong.
16. **Recovery semantics**: answers autosave to the session document as
    given (compare-and-set per `rev`/merge-by-`questionId`, step 13) — but
    autosave never triggers step 14's finalization. On reload, an
    `in_progress` session past deadline auto-submits (step 9); one still
    within deadline resumes with correct remaining time; a session stuck in
    `finalizing` resumes from its incomplete markers (step 14). Exiting
    without submitting prompts confirmation; an `abandoned` session
    (explicit exit or long-idle) never enters finalization at all, so
    incomplete attempts can't pollute performance data — this falls out
    directly from "only a session that reaches finalization calls
    `recordAnswer`," not a separate exclusion rule to maintain.
17. **Hydration gating**: config modal and dashboard both check the relevant
    stores' `isHydrated` state before computing defaults/aggregates — avoids
    launching with a stale/empty question-bank default or rendering an
    empty dashboard as "no data" during initial Firestore hydration.
18. Dashboard on the same tab: per-lecture performance breakdown, derived
    **exclusively from submitted `examSessions` documents** (query by
    `blockId`, group by their snapshotted lecture provenance) — never from
    `lectureQuestionStats`, which mixes exam and ordinary per-lecture Quiz
    answers and can't isolate an Integrated-Exam-only view. Block-scoped
    only (see Key decisions — "everything" toggle cut from v1 entirely).
    Weak lectures link back via an explicit nav-state contract —
    `{tab: "lectures", lectureId}` — defined now rather than assumed;
    Lectures tab must accept and act on this incoming state (small addition
    if it doesn't already).
19. Tutor mode: saved preference (off by default). On explicit reveal only
    (not eagerly), generate via `src/llmBridge.js`, prompt grounded in the
    frozen question record (stem, choices, correct answer, explanation,
    source lecture context) and labeled as supplemental content. Cached by a
    stable question hash; in-flight requests for the same question dedupe;
    request is cancelled if the user navigates away before it resolves.
20. **Submission observability**: local session status tracks
    `pending`/`synced`/`error` for the persistence write (today's stores only
    `console.warn` on cloud write failure). Failed writes retry; the UI shows
    an explicit "results saved" confirmation, not silence.
21. Wire the new tab into `src/shell/TabBar.jsx` / `Shell.jsx` alongside
    Today/Lectures/Objectives/Guide/More.

## Required test coverage

Named explicitly per Codex round 1 (#25) rather than left implicit:
- Allocation policy: deterministic given fixed inputs; minimum-coverage
  guarantee holds; weighted sampling respects weakness/objective-count
  weights (pure-function unit tests, `schedule.js`-style fixtures).
- Timer: fake-timer tests for deadline persistence, reload-past-deadline
  auto-submit, visibility/focus reconciliation, no free-time-from-throttling.
- Scoring: unanswered-as-incorrect, post-deadline answer rejection,
  malformed-choice exclusion at generation time.
- Submission idempotency: concurrent timer-fire + manual-submit + unmount
  can't double-score or double-persist. Narrowed to what's actually
  provable: completed-marker replay never re-processes a `questionId`
  already in `statsRecordedQuestionIds`. Separately, an explicit test for
  the honestly-bounded (not falsely-bounded) accepted risk: a question
  whose marker write keeps failing while its data write keeps succeeding
  can accrue extra increments proportional to reconciliation attempts, not
  a fixed count — assert this stays confined to `lectureQuestionStats` and
  never touches `examSessions` truth.
- Store: session document conflict/idempotency (per-session doc, not
  block-map last-writer-wins); CAS conflict merges by `questionId`,
  ordered by `answeredAt`/`seq`/`writerId`, instead of overwriting.
- Weak-concept write path: cumulative-across-sessions threshold aggregation
  (not per-session), no per-question record explosion, explicit
  correct/wrong `masteryLevel` transitions in both directions (struggling
  and recovery), stable-ID replacement via `mergeExamReportConcepts`.
- End-to-end: full submit flow (both formats), timeout auto-submit, reload
  mid-session (including mid-finalization), abandon flow,
  generation-failure-before-timer-start.

## Key decisions & tradeoffs

- **Single controller, dual format** (step 8) instead of two separate
  session components: less duplication, but scoring/persistence/allocation
  logic (steps 5-16) is entirely format-agnostic and lives outside the
  format branch — only rendering/pacing differs by `format`.
- **New Firestore collection, per-session mutable documents** (step 13) vs.
  reusing an existing store or a block-keyed map: per-session docs avoid the
  lost-update risk a block-keyed map would have across concurrent
  tabs/devices; needs a new `firestore.rules` entry.
- **Scoring calls the existing `recordAnswer` directly** (step 14) rather
  than building a new "canonical event pipeline" — that pipeline doesn't
  exist today (`recordAnswer` is a bare whole-doc read-modify-write with no
  event ID), and building one is store-layer migration work matching SP1's
  own mandate. Exam inherits that function's existing concurrency
  characteristics rather than claiming to fix them; it's a second caller of
  a pre-existing risk, not a new one.
- **Submission is a resumable two-phase finalization** (step 14), not a
  single flag flip — a crash between marking `submitted` and running its
  side effects was a real gap in round 2's version; the fix costs a
  `sideEffectsCompleted` marker pair and a "finalizing" intermediate status.
- **Weak-concept writes reuse `mergeExamReportConcepts`** (step 15) — the
  same merge-by-id function score-report uploads already use — with an
  explicit, bidirectional (struggling *and* recovery) transform computed
  fresh for this feature. Round 2 additionally claimed this reused
  `recordOutcome`; that was checked in round 3 and was false — corrected,
  not silently dropped.
- **"Everything" (term-wide) toggle cut from v1 entirely** — round 0 left it
  simultaneously described and deferred, which isn't a testable boundary.
  Decided now: block-scoped only for v1, term-wide is real future work, not
  assumed-free.
- **Answer-choice highlighting explicitly out of v1**: interaction pattern
  (toggle mode vs. double-click) undecided; stem highlighting ships as-is,
  choice highlighting deferred rather than blocking the tab on an unresolved
  UX question.
- **Question-count default source**: defaults from the newest question bank
  matching the active block's `blockId` (step 2). No such upload for a given
  block falls back to a static default of 20.
- **No server-side answer-key split** (rejected Codex #16): single-user local
  study tool, no proctoring/integrity threat model. UI-level gating (don't
  render answer content pre-submission) is sufficient; see step 12.
- **No session retention/archival policy** (rejected Codex round-4 #10): no
  other store in this repo has one; expected scale (one user, a handful of
  block-wide exams per term) doesn't approach where unbounded
  `examSessions` retention would hurt dashboard hydration. Real future
  concern if usage proves this wrong, not solved preemptively.
- **`recordAnswer`/weak-concept markers are awaited, not optimistic** (step
  14): added purely-additive awaitable write paths (exposing promises
  `writeCloud` already creates but discards today) so markers only flip
  after the underlying write actually resolves — closes the round-5 gap
  where markers could lie even without a crash. One residual risk remains
  and is accepted: the marker write itself is a second, separate Firestore
  write from the data write it guards, so true single-transaction
  exactly-once across two documents is still not built — bounded blast
  radius unchanged (adaptive-difficulty signal only, never exam truth).

## Risks / open questions

- Exact shape of the Integrated Exam controller hook: new hook, or extend
  `useObjectivesController`? Leaning new hook given cross-lecture scope diffs
  from per-lecture objectives, but not settled — resolve during
  implementation, low blast radius either way.
- Weighted-sampling weight formula (step 5, now fixed at 0.6/0.4
  severity/objective-count split) is a starting policy, not empirically
  tuned — expect to adjust after first real use.
- Question-bank meta staleness (step 2): a known accepted degradation, not a
  correctness bug — worth revisiting if it turns out to bite in practice.
- Clock-rollback-during-reload timer edge case (step 9): accepted residual
  risk, not solved further — low stakes for a single-user practice tool.

## Out of scope

- Answer-choice highlighting interaction (fast-follow).
- Term-wide (cross-block) rollup — cut from v1 outright, not deferred-maybe.
- Server-side answer-key enforcement — not applicable to this product.
- Any change to SP1's monolith-strangle work (`PLAN.md` at repo root) — this
  is a separate initiative, built on top of the shell architecture SP1
  produces, not part of SP1 itself.
