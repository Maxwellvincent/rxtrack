# Study protocol

Why RxTrack works the way it does. This is the design intent behind Deep Learn and the lecture
study flow — read it before changing either, because most of what looks like a missing feature
is a deliberate constraint.

The premise, in one line: **passive study kills flow, so the app must never hand you something
to read when it could hand you something to finish.**

| File | What it is |
|---|---|
| `flow-study-protocol.html` | The five-phase per-lecture protocol, written out in full |
| `mission.md` | Who this is for and what success looks like |
| `notes.md` | Learning preferences and the tools the protocol assumes |

## Where each phase lives in the code

| Protocol phase | Implementation |
|---|---|
| P0 Ingest | `src/ingest/`, `src/markerLocal.js`, `src/lectureText.js` |
| P1 Objectives → binary tickets | `src/objectiveGuides.js`, `src/lectureTeachingMap.js`, Deep Learn's objective-driven sessions |
| P2 Feedback engine (cards, case stems) | `src/ankiCards.js`, Deep Learn **patient** phase |
| P3 Debug loop (answer before reveal, misses are error messages) | Deep Learn **selftest** + **gaps**, `src/shell/features/lectures/LectureStudyFlow.jsx` rounds |
| P4 Teach and close | Deep Learn **teach** / **summary**, `src/deepLearnSessions.js` |

Deep Learn's phase order is `prime → teach → patient → selftest → gaps → apply → summary`
(`src/deepLearnPhaseUtils.js`).

## Pre-Read — the pass before the lecture (P-1)

Every phase above assumes the lecture has already been taught. Pre-Read is the pass that runs
before it, and it is deliberately a different shape:

| Piece | Implementation |
|---|---|
| Which lectures may be pre-read | `src/shell/logic/workAhead.js` |
| Session content (topics + prediction questions) | `src/shell/features/lectures/preRead.js` |
| The session UI | `src/shell/features/lectures/PreReadModal.jsx` |
| Recording it | `src/shell/logic/preReadLog.js` |
| Surface | Today's **Work ahead** section (`Today.jsx`) |

The session is five prediction questions answered *before* studying, one reveal screen, and a
list of concise subject-level topics to go study elsewhere (videos, PDFs — the app does not host
them). Fixed size, because a closable unit is what makes starting cheap.

Three rules here are load-bearing:

**A pre-read is rep 0.** `appendPreRead` is separate from `appendActivity` precisely because
`appendActivity` recomputes `reviewDates` and bumps `sessionCount` on every write.
`lectureUrgency` adds **+20** for `nextReview <= today`, so logging a pre-read through the normal
path would rocket an untaught lecture to the top of Today, and `recommendedSessionsFor` would
stop offering the first Deep Learn. Pre-read writes an activity entry and nothing else.

**Never grade unseen material.** The questions are ungraded by design — no objective ever moves
to `struggling` from a pre-read. Their only downstream use is `preReadGaps`: the missed
objectives are what the first post-lecture session opens on (`onQuiz` in `Today.jsx`).

**Work Ahead disappears inside exam week.** `workAheadLectures` suppresses itself in the `crunch`
and `critical` pressure zones (≤7 days to the block exam) — pre-reading the next lecture loses to
consolidating what the exam covers. It stays expandable by hand; it is a default, not a lock.

Horizon is the next two days (`HORIZON_DAYS`), and the section auto-opens only when nothing is on
fire — no struggling objectives in the block and no overdue spaced repetition. It does not gate on
"day 0 is empty", because `fallback.js` back-fills six urgency tasks and day 0 is therefore
essentially never empty.

## Two constraints that are easy to undo by accident

**Never render the whole extraction.** Study opens on a question, not on a list of atoms. The
atom list is reference behind a disclosure. A screen showing sixty definitions has no closable
unit on it, so there is nothing to start and nothing to finish — that failure is what
`ROUND_SIZE` and `atomRounds()` in `lectureStudy.js` exist to prevent.

**Say that stopping is allowed.** Each round of five ends by offering the next five rather than
assuming all sixty. Permission to stop after one round is what makes starting cheap.

## History

This began as a standalone workspace at `~/Projects/med-teach`, split off from RxTrack during a
period the app was not being worked on. It never held code — a protocol document and empty
folders — while the study loop it described was being built here. It was retired into this
directory on 2026-08-01 so study logic has one home.

The protocol is also mirrored as an Obsidian note at
`D:\Uchiha Clan\03 Projects\Medical Journey\05 System\Flow Study Protocol.md`. Keep the two in
sync if the protocol changes.
