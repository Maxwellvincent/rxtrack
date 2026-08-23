# Plan Review Log: RXTrack Integrated Exam tab
Started 2026-08-23 (session local time). MAX_ROUNDS=5.

**Outcome after 5 rounds: deadlock at round cap, not APPROVED.** User asked
for one more round (round 6) rather than stopping — see below.

## Round 6 — Codex (user-requested extra round, beyond original MAX_ROUNDS=5)

Same thread. 4 findings, VERDICT: REVISE. All four caught real defects in
round 5's own fixes — validates that continuing past the original cap was
worth it.

1. The proposed awaitable sibling would still report failure as success — `writeCloud`'s promise is already `.catch(console.warn)`'d internally, so returning that promise resolves even after a rejected write; the catch swallows the error before it ever reaches the awaiter.
2. Stats blast radius understated — one boolean marker guards up to 50 `recordAnswer` calls; a crash after 49 of them means retry re-runs all 50, so repeated crashes can duplicate many increments, not "at most one" as claimed.
3. Weak-concept transform isn't actually replay-safe — stepping `struggling → developing → mastered` reads the *currently stored* level and advances it one step, so replaying after a marker failure can advance mastery twice.
4. Objective-count normalization (`normalize(objectiveCount, 0..1)`) still has no defined denominator or zero-case — multiple valid implementations remain.

### Claude's response

All 4 fixed:

- **1**: The awaitable sibling must not swallow rejection — it returns (or
  rethrows after logging) the uncaught write promise, so a rejected Firestore
  write actually causes the awaiter's promise to reject and the marker is
  never set. This was a real gap in round 5's own fix, not a restatement of
  an already-accepted risk.
- **2**: Retracted "at most one extra increment." Real behavior documented
  instead: completion is tracked per `questionId` within the stats side
  effect (not one boolean for the whole batch) — a crash mid-batch resumes
  only the unrecorded questions, bounding duplication to genuinely at most
  one per question, matching what was originally (incorrectly) claimed for
  the whole batch.
- **3**: `masteryLevel` is no longer computed by incrementing prior stored
  state. It's now a pure lookup from `consecutiveCleanSessions` directly:
  0-1 clean sessions → level driven by cumulative miss-rate (struggling
  path); 2-3 clean → `"developing"`; 4+ clean → `"mastered"`. Replaying
  identical session history always produces the identical level — no
  "step from wherever it currently is" advancement to duplicate.
- **4**: Formula specified: `objectiveCount / maxEligibleObjectiveCount`
  (max across the block's eligible lectures for this launch), zero maps to
  zero.

## Round 7 — Codex (user-requested)

Same thread. 3 findings, VERDICT: REVISE.

1. Schema (step 13) still literally defines `sideEffectsCompleted: {statsRecorded, weakConceptsRecorded}` as plain booleans — contradicts step 14's per-`questionId` tracking, never updated when 14 changed.
2. "At most one extra increment" is still falsely bounded — if the per-question marker itself repeatedly fails while the underlying stats write keeps succeeding, every reconciliation attempt re-increments; nothing caps the retry count.
3. CAS tie-break (`answeredAt` + `seq`) can still collide — `seq` is only monotonic per writer/tab, so two different tabs can produce identical `answeredAt`+`seq` for the same question with no deterministic winner.

### Claude's response

All 3 fixed:

- **1**: Schema corrected — `statsRecorded` replaced with
  `statsRecordedQuestionIds: string[]` (set of completed question IDs, not
  a boolean), matching what step 14 actually requires.
- **2**: Retracted "at most one" outright. Documented honestly instead: the
  duplication risk is bounded by *reconciliation attempts*, not a fixed
  count — each reconciliation only re-attempts questions not yet in
  `statsRecordedQuestionIds`, so a question already marked never
  re-increments, but a question whose marker write keeps failing while its
  `recordAnswer` write keeps succeeding could accrue one extra increment
  per failed-marker reconciliation. Rare (needs the marker write
  specifically, not the data write, to be the one failing, repeatedly) and
  still bounded to the adaptive-difficulty signal only — not claiming a
  number that isn't actually guaranteed.
- **3**: Added stable `writerId` (per-tab/session identifier) as the final
  tie-break after `answeredAt`/`seq` — lexical compare, deterministic across
  any two writers.

## Round 1 — Codex

thread_id: `01a02cde-4fba-79c2-8839-f87fca1f5907`

25 findings, VERDICT: REVISE. Full text preserved verbatim below.

1. "Most recent real-exam upload" undeterminable — `questionBanksStore` has no `uploadedAt`/`blockId`. Fix: add bank metadata `{id, filename, blockId, uploadedAt, questions}`.
2. Exemplars leak across blocks — `readExemplars()` flattens all banks. Fix: block-filtered exemplar reader + documented no-bank fallback.
3. Provenance vs. fuzzy matching confused — generated questions should carry immutable `blockId`/`lectureId`/objective IDs at generation time, not get fuzzy-rematched after the fact (0.3 threshold risk).
4. Cross-lecture allocation undefined — no sampling/weighting/dedup policy; large lectures could dominate, weak lectures could vanish.
5. Question-count feasibility unspecified — no handling for lectures with too few objectives/usable text.
6. Difficulty semantics ambiguous/wrong — applying both `resolveDefaultDifficulty` (baseline) and `roundDifficulty` (round-index escalation) has no defined "round" concept for a cross-lecture exam; could arbitrarily inflate.
7. "Feed `weakConceptsForLecture`" isn't an implementation — that fn is read-only; plan never defines the write path from exam miss → weak-concept record.
8. One urgency record per wrong question over-punishes lectures with more questions on the exam — needs aggregation/thresholds.
9. New session store risks lost updates — block-keyed map + whole-doc replacement loses concurrent sessions across tabs/devices.
10. Session persistence schema entirely unspecified — no version, session ID, status, snapshot, deadline, format, retention policy.
11. Auto-submit race conditions — timer callback + manual submit + unmount + rerender could double-score/double-persist.
12. Timer not robust to background-tab throttling/sleep/reload — interval-tick counting grants free time or loses the exam on refresh.
13. Format A's "all questions up front" contradicts the plan's own stated generation-latency risk — no question should still be generating once the timer starts.
14. Active-block changes mid-session could corrupt attribution — session needs to snapshot `blockId`/lecture provenance and be immune to block navigation.
15. Scoring rules absent — unanswered, `correct: null`, malformed choices, late clicks at expiry, all unspecified.
16. Format A holds full answer keys in client memory for the whole exam — trivially inspectable; recommends server-side answer keys for real integrity.
17. Tutor mode has no request lifecycle/cost controls — per-question LLM calls could race, duplicate, or bill unexpectedly.
18. Tutor output not grounded — could hallucinate against the stored correct answer.
19. No hydration gating — Firestore-backed stores return fallback data pre-hydration; config/dashboard could compute on stale/empty data.
20. Weak-lecture dashboard links don't match existing component contracts — `WeakConcepts`/Lectures have no documented lecture-preselection API.
21. "Everything" toggle is simultaneously described, deferred, and left open — not a testable v1 boundary as written.
22. No recovery behavior for reload/exit/generation-failure — resume/abandon semantics undefined.
23. Separate exam-results store risks diverging from `lectureQuestionStats`/adaptive difficulty — double-counting or non-atomic partial writes across two stores.
24. No observability for exam-submission persistence — only `console.warn` today; high-value data with no durable success indicator.
25. No test plan — timer boundaries, allocation, scoring, provenance, persistence conflicts, hydration, both formats all regression-prone with nothing specified.

### Claude's response

Accepted 24 of 25 as material — mostly real correctness/data-integrity gaps in
a plan that named components to reuse without specifying the actual contract
between this feature and them. Revised `PLAN.md` section by section (see
diff): added bank metadata + block-filtered exemplars (1,2); provenance
stamped at generation time, fuzzy matching reserved for untagged data (3);
explicit allocation policy — min coverage then weighted sampling (4); launch
feasibility check with exclusions shown (5); dropped `roundDifficulty` layer
entirely, exam draws each lecture's resolved baseline directly (6); defined
exam-miss→weak-concept write path with per-lecture/session aggregation and
thresholds, not one record per miss (7,8); switched session storage to
per-session immutable documents keyed by UUID instead of a block-keyed map
(9); added versioned session schema with explicit states (10); made
submission an idempotent transition gated by a single synchronous flag (11);
switched timer to persisted absolute deadline, reconciled on
visibility/focus/load (12); question generation now completes and validates
before `startedAt`/deadline is set — resolves 13 as a side effect of 12;
snapshot `blockId`+provenance into session state, block nav doesn't affect an
in-flight session (14); defined scoring rules explicitly (15); added tutor
mode request lifecycle — cache by question hash, dedupe in-flight, cancel on
navigate (17); tutor prompt now supplied the frozen stem/choices/answer/
explanation, labeled as supplemental (18); added hydration gating before
config/dashboard compute (19); defined explicit nav-state contract for
weak-lecture links instead of assuming one exists (20); cut the "everything"
toggle from v1 outright, no longer a soft maybe (21); defined resume/abandon
semantics + autosave (22); collapsed exam-results into the same canonical
answer-event pipeline objectives quizzes already write, rather than a second
store computing dashboards/difficulty independently (23); added explicit
sync-status UI (pending/synced/error) for exam submission (24); added a
required test-coverage section naming the regression-prone areas (25).

**Rejected: #16** (server-side answer keys). This is a single-user local
study tool, not a proctored/adversarial exam product — there's no integrity
threat model where Louis cheats against himself, and building a server
boundary purely to hide answer keys from the same person taking the exam is
scope the product doesn't need. Partially incorporated instead: the
UI still shouldn't *render* answer/explanation content before submission
(prevents accidental self-spoiling from a stray render), but the data itself
staying in client memory is fine and no server-side split is planned.

## Round 2 — Codex

Same thread. 17 findings, VERDICT: REVISE. Verified against actual repo code
before responding (not taken on faith): confirmed `saveBank`/`removeBank`
(`src/stores/questionBanks.js`) key by filename with no id/blockId;
`firestore.rules` has no exam-session subcollection; `writeCloud`
(`src/stores/cloudBase.js:212`) is fire-and-forget, `.catch` only
`console.warn`s, returns the input value synchronously not a promise;
`recordAnswer` (`src/stores/lectureQuestionStats.js:42`) is a bare
read-modify-write on a whole-document store, no event ID, no transaction —
Codex's concurrency claims were accurate, not hallucinated. Also confirmed
`recordOutcome` (`src/engine/mastery.js:14`) and `mergeExamReportConcepts`
(`src/shell/logic/examReportWeakConcepts.js`) exist and are real reuse
targets for the weak-concept write path.

1. Question-bank shape change breaks `readExemplars`/`flattenQuestionBanks`/DeepLearn/management UI (all expect `{filename: Question[]}`).
2. Filename identity stays collision-prone across blocks even with an added `id` field, since `saveBank`/`removeBank` aren't changed to operate on it.
3. "Per-session immutable documents" contradicts autosaving answers into the same document — no store primitive provides that contract yet.
4. `firestore.rules` has no exam-session path — needs an explicit owner-scoped rule.
5. Claimed "canonical answer-event pipeline" doesn't exist — `recordAnswer` does non-idempotent whole-doc increments, no event ID.
6. Per-session docs don't solve the underlying concurrency — exam and quiz answers can still race the same `rxt-lecture-qstats` aggregate doc.
7. Autosave-as-answers-given vs. abandoned-sessions-don't-count is undefined — writing canonical events during autosave makes exclusion/rollback undefined.
8. No refill policy when generation validation fails post-hoc — pool just shrinks below promised count.
9. One LLM call per question slot is unnecessarily chatty — batch per lecture instead.
10. Weak-concept lifecycle claims decay/mastery semantics that don't demonstrably exist as described — needs stable IDs + explicit `recordOutcome`-style update rule.
11. Miss-rate threshold still not a concrete number — blocks a testable acceptance criterion.
12. Allocation weight formula ("severity + objective count") has undefined scales, no seed, no tie-break rule.
13. Practice mode (Format B) timing left ambiguous — duration said "always required" but countdown/deadline only described for Format A.
14. Submission idempotency is in-memory only — doesn't survive reload/cross-tab/cross-device with the same session ID.
15. Session schema lacks revision/sync fields its own recovery design needs.
16. `writeCloud` swallows async failures — new session adapter can't reuse it as-is to report pending/synced/error.
17. Absolute deadline alone doesn't handle backward system-clock movement extending the timer.

### Claude's response

All 17 accepted — every one checked out against actual code, none were
speculative. Revised plan:

- **1, 2**: Don't touch `questionBanksStore`'s existing shape at all (avoids
  the breakage in #1). Add a *sibling* store, `src/stores/questionBankMeta.js`,
  `{[bankId]: {filename, blockId, uploadedAt}}`, populated at the `saveBank`
  call site (not inside the store) when a bank is uploaded. Exam-tab
  defaulting reads meta to find the newest bank for the active block, then
  reads that bank's content from the existing store by filename. Known
  residual limitation, accepted rather than fixed: if `removeBank`/re-upload
  changes what a filename points to, meta can go stale — degrades to picking
  a wrong-but-plausible default, never a crash, and the config modal always
  offers a manual override. Fixing filename-collision identity for the
  existing shared store is pre-existing debt this feature doesn't take on.
- **3, 4**: Session docs are correctly mutable (autosave/status updates) —
  retracted "immutable" framing. New Firestore collection
  `/users/{uid}/examSessions/{sessionId}`, one doc per session, with a rule
  added to `firestore.rules` (owner-scoped, same pattern as `dlSessions`).
- **5, 6, 7**: Retracted the "new canonical pipeline" framing entirely — it
  doesn't exist and building one is a store-layer migration matching SP1's
  own mandate, out of scope here. Instead: exam scoring calls the *existing*
  `recordAnswer(userId, lectureId, wasCorrect)` directly, exactly once per
  question, **only at submission time** (iterating the session's final
  answers) — never during autosave. This inherits `recordAnswer`'s existing
  whole-doc race characteristics rather than claiming to fix them (that race
  already exists between two browser tabs running objectives quizzes today;
  exam adds a second caller of the same pre-existing-risk function, it
  doesn't introduce a new one). Autosaved answers stay session-local only
  until submission; abandoned sessions never call `recordAnswer` at all,
  cleanly resolving #7.
- **8**: Retry invalid/missing generation slots up to 2 attempts each; if
  still short after retries, abort launch before the timer starts (never
  silently launch with fewer than the confirmed count).
- **9**: Generate per-lecture batches (one call per lecture for its full
  allocation), not one call per question. Validate the batch; refill only
  the deficient lecture's shortfall.
- **10**: Exam weak-concept entries reuse `mergeExamReportConcepts`
  (`examReportWeakConcepts.js`) and `recordOutcome`
  (`src/engine/mastery.js`) — the exact path score-report uploads already
  use — with a stable ID scheme `exam:<blockId>:<lectureId>`. No new/assumed
  decay mechanism invented; behavior matches whatever `recordOutcome`
  already does for every other caller.
- **11**: Concrete threshold set: miss-rate ≥ 40% on a lecture, minimum 3
  questions from that lecture in the session (below 3, too few samples to
  flag).
- **12**: Weight formula specified: `normalize(weakSeverity, 0..1) * 0.6 +
  normalize(objectiveCount, 0..1) * 0.4`. Seed = `sessionId` (deterministic
  PRNG, not `Math.random()`). Tie-break: lectureId lexical order.
- **13**: Format B is untimed — the duration field only applies to Format A;
  no countdown renders in Format B. "Duration always required" language
  corrected to "required when Format A is selected."
- **14**: Submission transition (`in_progress → submitted`) is a Firestore
  transaction with an `in_progress`-only precondition, not just an in-memory
  flag — survives reload/cross-tab/cross-device.
- **15**: Added `rev`/`updatedAt` fields to the session schema; concurrent
  autosaves use compare-and-set against `rev`.
- **16**: New dedicated write function for session docs returns the
  underlying Firestore write promise (doesn't reuse `writeCloud`'s
  fire-and-forget shape) — session UI can genuinely distinguish
  pending/synced/error instead of only ever showing optimistic success.
- **17**: Timer tracks monotonic elapsed time (`performance.now()`) alongside
  the persisted wall-clock deadline once the page is open; a backward
  wall-clock jump during an open session is ignored in favor of the
  monotonic delta. Wall-clock deadline is still what's used to compute
  remaining time immediately after a reload (no monotonic baseline survives
  a reload by definition), which is the one window a clock-rollback-during-
  reload could still exploit — documented as an accepted residual risk (low
  stakes: a self-inflicted clock trick against one's own practice exam).

## Round 3 — Codex

Same thread. 13 findings, VERDICT: REVISE. Verified two before responding:
confirmed `mergeExamReportConcepts` never calls `recordOutcome` (grepped both
files — round 2's claim that this was "the exact path score-report uploads
already use" was factually wrong, `buildWeakConceptEntriesFromReport` builds
entries with a hardcoded `masteryLevel: "struggling"`, no `recordOutcome`
anywhere in that file); confirmed `AtomQuiz.jsx:204` renders a choice's `txt`
directly as a React child (`<span>{txt}</span>`) — throws if `txt` is a
table-shaped object, so table-shaped choices genuinely aren't renderable by
the existing quiz UI today. Also confirmed real `masteryLevel` enum values
(`mastered | developing | struggling`, `src/shell/features/tracker/weakConcepts.js`).

1. Submission isn't exactly-once end-to-end — transaction marks `submitted` before `recordAnswer`/weak-concept side effects run; a crash mid-way leaves a permanently-submitted, partially-scored session with no retry path.
2. Observability only covers the session doc — `recordAnswer`/weak-concept writes are still fire-and-forget, so "results saved" can lie about whether derived stats/urgency actually updated.
3. Dashboard has no defined data source — `lectureQuestionStats` mixes exam + ordinary quiz answers, can't provide an Integrated-Exam-only breakdown as promised.
4. **Factually wrong claim**: score-report uploads never call `recordOutcome`; no existing path combines it with `mergeExamReportConcepts`.
5. Weak concepts can never recover under the specified path — only threshold-crossing (bad) sessions write/bump; nothing ever applies a "correct" outcome, so an exam-derived entry stays "struggling" forever even after later good exams.
6. Min-3-questions threshold conflicts with min-coverage allocation — an exam spanning many lectures may give every lecture only 1 question (min coverage), so no lecture ever reaches 3 in a single session, and the weak-concept path silently never fires.
7. Severity normalization undefined — `weakConceptsForLecture` returns an array of records, not a scalar; the 0.6-weight formula has nothing to normalize.
8. Cross-block exemplar leak still possible through the sibling-metadata design — re-uploading the same filename in block B replaces the shared content while block A's stale metadata keeps pointing at that filename.
9. Stale metadata isn't guaranteed to degrade plausibly — if the newest matching entry's filename was removed, that lookup yields nothing usable, not a graceful fallback.
10. CAS autosave conflict recovery unspecified — two tabs hitting a stale `rev` and blind-retrying can overwrite each other's answers instead of merging.
11. **Table-shaped choices validated but not renderable** — `AtomQuiz` throws rendering an object as `txt`; the plan accepts table-shaped questions as valid without a renderer for them.
12. Session schema lacks stable question IDs — answer arrays, CAS merge, tutor caching, and finalization markers can't safely key off mutable stems or array position.
13. Test-plan still requires "decay/mastery must match existing Weak Concepts behavior" even though the plan itself now says no decay mechanism exists — self-contradictory requirement.

### Claude's response

All 13 accepted, including the correction of my own round-2 factual error
(#4) — logging that plainly rather than quietly fixing it. Revised plan:

- **1, 2**: Redefined "saved" as session-doc durability only (that's what the
  UI's "results saved" now means, honestly). Submission becomes a resumable
  finalization: transaction sets `status: "finalizing"` (locks concurrent
  submits) after answers freeze; `recordAnswer` + weak-concept writes run,
  each tracked by a per-side-effect completion marker on the session doc
  (`sideEffectsCompleted: {statsRecorded, weakConceptsRecorded}`); `status`
  only flips to `submitted` once both markers are true. Any reconciliation
  read (reload, focus) that finds a session stuck in `finalizing` resumes
  from whichever markers are still false — idempotent, since a marker guards
  against re-running an already-done side effect.
- **3, 6**: Dashboard derives exclusively from submitted `examSessions`
  (query by `blockId`, group by snapshotted lecture provenance) — never from
  `lectureQuestionStats`. Same aggregation now also answers #6: miss-rate for
  the weak-concept threshold is computed across **all submitted sessions for
  that lecture in the block** (cumulative exam-only question count), not
  within one session — a single min-coverage session contributing 1 question
  per lecture still accumulates toward the 3-question floor over multiple
  exams, instead of the threshold silently never firing.
- **4, 5**: Retracted the wrong claim outright. New pure transform:
  given an existing exam-derived entry (stable ID `exam:<blockId>:<lectureId>`,
  if one exists) and this lecture's cumulative exam miss-rate (#3/#6),
  compute a replacement entry — threshold-crossing sets/bumps
  `masteryLevel: "struggling"` (real enum value, verified) with updated
  `missCount`/`lastMissed`; **not** crossing it with an existing entry
  present applies a recovery step (`consecutiveCorrect` increment,
  `lastCorrect` updated, `masteryLevel` stepped to `"developing"` then
  `"mastered"` after 2 consecutive clean cumulative windows) — then passes
  the result through `mergeExamReportConcepts` for its existing
  merge-by-id/replace semantics. `recordOutcome` reference removed entirely
  — it operates on a different concept shape in `src/engine/mastery.js`, not
  this store's, and doesn't fit here.
- **7**: Severity scalar defined explicitly: `min(nonMasteredWeakConceptCount
  for lecture, 5) / 5` (`weakConceptsForLecture` count, capped and
  normalized 0-1). No landmine/bonus term — that wasn't a confirmed concept
  in this codebase, not invented.
- **8, 9**: On `saveBank`, if the uploaded filename already has a meta entry
  for a *different* `blockId`, the new upload becomes the sole current owner
  for that filename (single-owner-per-filename, matching the fact that
  content itself is genuinely shared/flat by filename in the existing
  store — this is a real constraint of the underlying shared store, not
  something this feature can silently work around without a bigger content-
  keying migration, which stays out of scope). Metadata lookup now skips any
  entry whose filename no longer exists in the bank store and falls through
  to the next-newest, then the static default — never returns an unusable
  reference.
- **10**: CAS conflict resolution changed from blind retry to reread-and-merge:
  on `rev` mismatch, reread the current doc and merge answers by stable
  question ID (added in #12) — last-write-wins per-question, not per-document,
  so two tabs answering different questions merge cleanly. No single-editor
  lock (too restrictive for an accidental-second-tab case).
- **11**: Generation prompt for Integrated Exam questions is constrained to
  plain-text choices only, even though exemplars may include table-shaped
  ones — cheaper than building a new table-choice renderer for a UI surface
  that doesn't need to reproduce arbitrary uploaded-exam formatting, since
  every exam-tab question is freshly LLM-generated (step 6), never a
  directly-reused parsed bank question.
- **12**: Added a stable `questionId` (generated at creation) to each frozen
  question in the session snapshot; answers, CAS merge (#10), tutor caching,
  and finalization markers all key off `questionId`, never array position or
  stem text.
- **13**: Test-plan wording corrected to match the actual mechanism: explicit
  correct/wrong cumulative-window transitions and stable-ID replacement via
  `mergeExamReportConcepts`, not a nonexistent "decay" requirement.

## Round 4 — Codex

Same thread. 10 findings, VERDICT: REVISE.

1. Completion markers aren't atomic with their side effect — `recordAnswer` can succeed, then crash before `statsRecorded` writes, so a retry double-increments.
2. Weak-concept finalization queries only `submitted` sessions, but the session being finalized is still `finalizing` at that point — excludes its own answers from its own cumulative calculation.
3. Canonical schema (step 13) lists only `in_progress|submitted|abandoned`, omitting the `finalizing` status and `sideEffectsCompleted` marker step 14 actually requires.
4. Cumulative miss-rate can't represent "consecutive clean windows" as specified — a lifetime-bad lecture can never recover even after recent good sessions, and vice versa.
5. Prompt-level "plain text only" isn't enforced — `normalizeQuestions` accepts object-valued choices, so a model ignoring the instruction still produces a validated, renderer-crashing question.
6. Mutable session document has no size bound — uncapped question count + full snapshots can exceed Firestore's 1 MiB document limit.
7. CAS "last-write-wins per question" has no defined ordering value — nothing to compare when merging two answer objects.
8. Autosave isn't explicitly forbidden after finalization begins — a stale tab could mutate frozen answers while scoring is running.
9. Weak-concept write has the same marker-gap as #1 — a whole-store write can succeed before its marker, so replay could double-apply a transition.
10. No retention strategy for the session collection — unbounded full-snapshot retention degrades dashboard hydration over time.

### Claude's response

8 of 10 fixed outright, 2 accepted as documented trade-offs rather than built
out — round 4 is the point of diminishing returns for a personal single-user
tool, not more unresolved gaps:

- **2, 3**: Real oversights, fixed directly. Step 13's schema now literally
  includes `"finalizing"` and `sideEffectsCompleted`. Step 15's cumulative
  query now explicitly includes the finalizing session's own (already-frozen)
  answers alongside prior `submitted` sessions, deduped by session ID.
- **4**: Split the two purposes cumulative miss-rate was doing. Initial
  flagging (crossing into `"struggling"`) still uses lifetime-cumulative
  miss-rate (fine — it's meant to be sticky-until-addressed). Recovery streak
  now uses each individual newly-submitted session's own miss-rate (<40% in
  that session = "clean"), counted over the most recent submitted sessions
  for that lecture — not the lifetime cumulative figure. Fixes both
  directions of #4's failure mode.
- **5**: Added explicit exam-specific validation — any question with a
  non-string choice value is rejected before launch, independent of prompt
  compliance.
- **6**: Capped max launchable question count at 50; added a serialized-size
  check before the session write, erroring rather than silently exceeding
  Firestore's 1 MiB limit.
- **7**: Added `answeredAt` (client timestamp) per answer as the CAS merge
  ordering value, with a monotonic per-answer counter as tie-break if
  timestamps collide.
- **8**: Autosave transactions now require `status === "in_progress"`
  explicitly — rejected once `finalizing`, `submitted`, or `abandoned`.
- **9**: Made the weak-concept replacement a pure function of queryable
  submitted-session data (recomputed fresh from the cumulative/streak query
  each time, not incremented from prior stored state) — a replayed write
  produces the identical value, so the marker gap can't cause double-
  application here. This was directly achievable since round 3 already
  computes miss-rate by querying `examSessions`, not by mutating counters.

**Accepted as documented trade-offs, not built:**
- **#1** (recordAnswer marker gap): `recordAnswer` is out-of-scope to modify
  (round 2's decision — it's shared, pre-existing, store-layer work matching
  SP1's own mandate). Codex's alternative fix — derive lecture stats from
  submitted sessions instead of calling `recordAnswer` at all — was
  considered and rejected: it reintroduces exactly the dual-pipeline
  divergence risk round 2 (#5-7) fixed by removing. Documented instead as an
  accepted residual risk: the crash window is narrow (between a successful
  `recordAnswer` write and its marker write), and the blast radius is
  bounded — it only nudges `lectureQuestionStats`, the adaptive-difficulty
  input, not the exam's own scoring or dashboard (both of which read
  directly from `examSessions`, unaffected by this). A rare double-counted
  answer in a difficulty ramp signal is self-correcting noise, not data
  corruption, for a single-user practice tool.
- **#10** (retention strategy): Not building pagination/archival
  infrastructure for v1 — no other store in this repo has one, and expected
  scale (one user, a handful of block-wide exams per term) doesn't approach
  where unbounded `examSessions` retention would actually hurt dashboard
  hydration. Noted as a real future concern if usage patterns prove this
  wrong, not solved preemptively.

## Round 5 — Codex (MAX_ROUNDS, final)

Same thread. 4 findings, VERDICT: REVISE. This is the configured round cap
(`MAX_ROUNDS=5`) — no round 6 is sent. Per skill: fix what can be fixed on
Claude's own judgment, then hand to human sign-off rather than manufacture a
false APPROVED.

1. `statsRecorded` can't truthfully mean "recorded" — `recordAnswer()` calls fire-and-forget `writeCloud()`, which returns before Firestore confirms and swallows rejections; finalization could mark the marker true right after a write that actually failed, with no reconciliation path.
2. `weakConceptsRecorded` has the identical durability hole — making the *value* replay-safe doesn't help if the marker is set before the write that persists it actually succeeds.
3. Weak-concept signal precedence undefined — lifetime-cumulative can demand `"struggling"` in the same evaluation where the 2-latest-session streak demands `"mastered"`; step 15 never said which wins.
4. Required test-plan wording contradicts the accepted trade-off — it asserts recovery happens "without double-calling `recordAnswer`," while the plan explicitly accepts a crash window where that can happen.

### Claude's response

All 4 addressed in this final revision (not re-submitted to Codex — round cap
reached):

- **1, 2**: Both markers now require an actual awaited write success, not
  "called the fire-and-forget function." Added purely-additive awaitable
  write paths used only by exam finalization — existing callers/behavior of
  `writeCloud`, `recordAnswer`, and `weakConcepts.write` are untouched (this
  does not reopen the round-2/4 scope boundary against fixing those stores'
  concurrency *model* — it only exposes the promise that `writeCloud`
  already creates internally today and currently discards). Verified viable:
  `writeCloud` (`src/stores/cloudBase.js:212`) already does
  `Promise.resolve(put(...)).catch(...)` — the promise exists, it's just not
  returned or awaited by any current caller, so adding an awaitable sibling
  changes nothing for existing callers.
- **3**: Defined a single decision order, not two competing signals: track
  `consecutiveCleanSessions` per lecture (resets to 0 on any non-clean
  session). If that count is ≥ 2, the recovery step wins outright — cumulative
  miss-rate is not separately consulted while a recovery streak is active.
  Only when the streak is below 2 does cumulative miss-rate get to drive
  `"struggling"`. Recent performance always takes precedence over lifetime
  history once a streak is established.
- **4**: Test-plan wording narrowed to what's actually guaranteed —
  completed-marker replay cannot double-apply once a marker is true (that's
  the real, provable claim). Added an explicit documented case for the
  accepted crash window instead of asserting it away: a test asserting the
  *bounded* behavior (at most one extra `recordAnswer` increment, never
  more, never corrupting `examSessions` truth) rather than asserting the
  window can't occur.

