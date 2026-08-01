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
