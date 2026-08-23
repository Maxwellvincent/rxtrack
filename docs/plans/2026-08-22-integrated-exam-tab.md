# Integrated Exam tab

> Spec drafted directly (not via `/to-spec`, user-invocation-only). Ready for `/codex-review` before build.

## Problem

Per-lecture Quiz mode (`src/shell/features/objectives`) can't reproduce real
Esoft/IMCQ exams: those mix objectives across a whole term/block, not one
lecture. Louis needs block-wide, timed, exam-condition practice plus a
practice-mode variant, with a performance dashboard that routes weak lectures
back into the existing urgency/scheduling system.

Goal: pass basic sciences with A/Bs. Immediate need is exam-realistic practice
that surfaces weak lectures automatically — Louis rarely tunes settings
manually, so defaults must carry the weight.

## Locked decisions (from grilling session, 2026-08-22 memory capture)

1. **New top-level tab**, alongside Today/Lectures/Objectives/Guide/More in
   `src/shell/TabBar.jsx` / `Shell.jsx` — not a mode nested inside another tab.
2. **Scope = whole active block**, cross-lecture. Reuse `matchTextToCandidates`
   (already 3 callers) for any lecture/topic fuzzy-matching this tab needs.
3. **Two formats, selectable at launch:**
   - **(A) Exam conditions** — all questions presented up front, no
     per-question feedback, hard countdown timer, auto-submits at time limit,
     review screen only after full submission.
   - **(B) Practice** — one-at-a-time, immediate reveal/explanation (same UX
     family as today's per-lecture Quiz), cross-lecture scope + real-exam
     wording.
4. **Launch config**: question count, defaulting from the most recently
   analyzed real exam upload when available (fall back to a static default
   otherwise); duration is user-set (source PDFs don't carry timing).
5. **Dashboard on the same tab**: per-**lecture** breakdown of Integrated Exam
   performance — reuse existing lecture granularity, not a new topic-tagging
   system. Each weak lecture links back to it (pattern: Weak Concepts /
   Struggle Tracker's existing block-scoped-by-default + "everything" toggle
   is the likely home for a block-wide vs. term-wide performance rollup).
6. **Tutor mode** (separate toggle, off by default, saved preference): after
   answering, show an LLM-generated breakdown of what the question was
   actually asking — a panel distinct from the existing right/wrong
   explanation. Targets parsing dense vignette wording under exam conditions.
7. **Answer-choice highlighting**: stem highlighting is already live
   (`src/ui/LabValue.jsx`: `applyHighlights` / `LabAnnotatedText`, wired in
   `src/shell/AtomQuiz.jsx`). Choices were explicitly deferred — they sit
   inside clickable pick-this-answer buttons, so drag-to-select fights the
   click. Needs an interaction decision (toggle mode vs. double-click) before
   wiring in; **not required for v1 launch**, tracked as a fast-follow.

## Reuse — do not rebuild

- **Exemplar pipeline**: `QuestionBankModal.jsx` → `questionBanksStore.js` →
  `quizLaunch.js:readExemplars()` — feeds real-exam-style few-shot examples
  into generation calls. Parser (`examParser.js`, `mcq.js`) already handles
  4-8 lettered choices + table-shaped answer choices.
- **Weak-category auto-flagging**: `src/shell/logic/examReportWeakConcepts.js`
  — score-report uploads auto-detect category tables, flag weak categories
  into Weak Concepts, matched to lectures via `matchTextToCandidates`.
- **Urgency boost**: `weakConceptsForLecture` in `src/shell/logic/schedule.js`
  feeds weak-concept severity into `lectureUrgency` (Today's Daily Plan +
  Lectures tab sort). Integrated Exam misses should feed the same path.
- **Adaptive difficulty**: `resolveDefaultDifficulty`
  (`src/shell/features/objectives/quizLaunch.js`) and `roundDifficulty`
  (`src/shell/features/lectures/lectureStudy.js`) ramp default difficulty off
  cumulative accuracy. Integrated Exam questions should draw at the same
  ramped difficulty per lecture, not a flat default.
- **Weak Concepts / Struggle Tracker block-scoping**: both already default to
  active-block with an explicit "everything" toggle — reuse this pattern for
  Integrated Exam's own block-vs-term rollup rather than inventing a new
  scope control.

## Scope for v1

In:
- New tab (`src/shell/features/exam/` — new directory, follow
  `objectives`/`lectures` structure: container + config modal + launch logic
  + controller hook).
- Launch config modal: format (A/B), question count (defaulted), duration.
- Session runner: format A (up-front, timer, single submit) and format B
  (one-at-a-time, immediate reveal) share underlying question set + scoring,
  diverge only in presentation/pacing — implement as one controller with a
  `format` flag, not two parallel trees.
- Per-lecture performance dashboard on the same tab, block-scoped by default.
- Weak-lecture links from dashboard back into existing Lectures tab / Weak
  Concepts.
- Tutor mode toggle wired into format A's post-submission review screen (and
  format B's per-question reveal) — saved preference, off by default.

Out (fast-follow, not v1):
- Answer-choice highlighting (interaction pattern undecided).
- Term-wide (cross-block) rollup — block-wide only for v1, unless the existing
  "everything" toggle pattern makes this nearly free to include.

## Open questions for `/codex-review`

- Exact shape of the Integrated Exam controller hook vs. reusing
  `useObjectivesController` patterns — new hook or extend existing?
- Where session results persist (new store module under `src/stores/*` per
  SP1's store-modules convention, keyed per block) — needs a `notifyStoreChanged`
  wiring like other stores.
- Question generation must route through `src/llmBridge.js` (confirmed present,
  already used by `Today.jsx`, `preRead.js`, `LectureStudyFlow.jsx`) —
  bridge-first, cloud fallback, per CLAUDE.md's LLM-bridge default. Not open,
  just a build-time reminder.
