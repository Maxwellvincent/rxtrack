# Unify Quiz, Study, and Rounds around atom completion

> Drafted from a direct `mattpocock-skills:grilling` session (no `/to-spec`) —
> user chose to build straight from the locked decisions below.

## Problem

Quiz mode and Study mode (rounds) are two independently-tracked systems that
both update objective status via different algorithms, and neither tracks
individual atoms as complete. A missed question gives no way back to the
specific atom/objective it came from — the user has to guess what to review.

## Locked decisions (grilling session, 2026-08-23)

1. **One runner.** "Quiz this lecture" stops being a separate top-level
   overlay (`Shell.jsx`'s `quiz` state + its own `onDone`). It always opens
   `LectureStudyFlow` (count/difficulty picker intact); the standalone
   overlay and its duplicate objective-status logic are deleted.
2. **Atom "complete" = correct-at-least-once.** A miss doesn't complete an
   atom — it flags "needs review" until answered correctly.
3. **Quiz mode draws specific atoms first**, then generates one question per
   atom — same positional-attribution posture Study's rounds already use.
   No more fuzzy topic-text matching for "what atom was this question about."
4. **Atom selection prioritizes incomplete atoms** — a request for N
   questions spends all N on not-yet-correct atoms before ever repeating a
   mastered one (only cycles back once incomplete atoms run out).
5. **Progress bar becomes atoms-mastered** ("14/23 atoms"), not
   rounds-completed. `ROUND_SIZE=5` survives only as a pacing knob for one
   sitting. The `lectureRounds` done-counter is retired.
6. **Jump-back lives in the end-of-session summary** — a "needs review" list
   (broadened from today's landmines-only to every not-yet-correct atom,
   landmines flagged first). Each entry links to that atom's card: opens the
   atoms list, expands it, scrolls to and highlights the card. Not inline
   mid-quiz (breaks flow, needs resume-state).
7. **Objective mastery becomes atom-derived** — an objective is mastered once
   its own linked atoms are complete, evaluated per-objective. The existing
   exam-pressure curve (`computeTargetStatus`) still sets how lenient
   "mastered" is as the exam nears, just applied per-objective off that
   objective's own atoms instead of blanket-per-lecture.

## Data model — new

`src/stores/atomProgress.js` — per user, per lecture, keyed by
`normAtomKey(atom.term)`:

```js
{ [lectureId]: { [atomKey]: { status: "complete" | "needs-review", correctCount, missCount, lastAt } } }
```

- `needs-review` set the first time an atom is missed and stays set until a
  later correct answer flips it to `complete`.
- `complete` is sticky once reached... except a *later* miss on an already-
  complete atom flips it back to `needs-review` — mastery isn't permanent,
  same spirit as the existing "struggling" status in `graduationGate.js`.

## Changes by file

- **`src/stores/atomProgress.js`** (new) — record/read atom outcomes, derive
  `masteredCount`/`totalCount` for a lecture, list `needsReview` atoms.
- **`src/shell/AtomQuiz.jsx`** — `recordAnswer` call also writes atom
  progress (needs an atom-key prop per question, not just `lectureId`).
  Summary broadens landmines-only list to all `needs-review` atoms touched
  this session (landmines still sorted first), each entry calls a new
  `onReviewAtom(atomKey)` prop instead of being inert text.
- **`src/shell/features/lectures/lectureStudy.js`** — atom selection helper:
  given all atoms + atomProgress state + a requested count, return the atoms
  to quiz (incomplete-first, wrap to complete only once exhausted).
- **`src/shell/features/objectives/quizLaunch.js`** (`startObjectiveQuiz`) —
  rebuilt to select atoms via the new helper, then generate one question per
  atom (mirrors `quizFromAtoms`), instead of one big free-form generation
  pass across all objectives.
- **`src/shell/features/lectures/LectureStudyFlow.jsx`** — progress bar reads
  atoms-mastered from `atomProgress`, not `lectureRounds`. "Quiz this
  lecture" picker still lives here (unchanged UI), but its `onStartQuiz` now
  runs the same atom-driven generator Study rounds use. Atom cards in the
  "review all atoms" list get a stable id
  (`id={`atom-${normAtomKey(a.term)}`}`) for `onReviewAtom` to open the
  `<details>`, `scrollIntoView`, and pulse-highlight.
- **`src/shell/Shell.jsx`** — standalone `quiz` state, its `<AtomQuiz>`
  render, and its `onDone` objective-status handler are deleted. Today/
  Lectures-list "Quiz" buttons now call `onStudyLecture` (open
  `LectureStudyFlow`) with a prop that auto-opens the quiz picker (or
  auto-starts, count/difficulty pre-filled) instead of `onStartObjectiveQuiz`.
- **`src/shell/logic/graduationGate.js`** — `computeTargetStatus` keeps its
  exam-pressure curve/signature, but the *caller* (`LectureStudyFlow.jsx`)
  now evaluates it once per objective using that objective's own linked
  atoms' completion fraction as the score input, not one lecture-wide
  aggregate score reused for every objective.
- **`src/shell/features/lectures/lectureProgress.js`,
  `src/stores/lectureRounds.js`** — round-done persistence retired (atoms are
  the ground truth now); `ROUND_SIZE`/`atomRounds` stay for slicing one
  sitting's batch, just stop being what "progress" means.

## Migration note

Existing users' round-done counters are not backfilled into atom-complete
state — there's no reliable way to know which specific atoms a past round
covered correctly. Everyone's atoms-mastered bar starts at 0 and rebuilds
from here forward. Worth a one-line heads-up in the PR/commit, not a blocker.

## Out of scope (not asked for, not touched)

- Cross-lecture/term-wide rollups.
- Changing how objectives get *linked* to atoms (`tagAtomsWithObjectives`
  stays as-is).
- The Integrated Exam tab plan (separate, still unbuilt).
