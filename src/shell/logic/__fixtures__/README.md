# Schedule fixtures (SP1 T4.1/T4.2)

Recorded from the **live App.jsx** on 2026-07-27 by a dev-flag-gated probe,
which the plan required be deleted once these fixtures were captured and
asserted (T4.2). `src/shell/logic/schedule.fixtures.test.js` now reproduces
every one of them from the pure module.

## Re-capturing (if App's schedulers ever change on purpose)

The probe and its dev-only vite sink were removed in the T4.2 commit; restore
them from git and re-run:

```
git show <T4.1 commit>:src/devtools/scheduleProbe.js > src/devtools/scheduleProbe.js
git show <T4.1 commit>:vite-plugin-fixture-sink.js  > vite-plugin-fixture-sink.js
# re-add fixtureSink() to vite.config.js and the installScheduleProbe() effect to App.jsx

http://localhost:5173/?shell=old&probe=schedule    # ?shell=new is sticky — App won't mount without shell=old
> await __rxtScheduleProbe.captureAll()
```

Both sides project through `src/shell/logic/scheduleFixtureShape.js`, so a
re-capture stays comparable to the pure module's output.

One file per block that has an exam date. Each holds:

- `context` — the `ScheduleContext` T4.2 specifies, resolved to **data**:
  terms/blockMeta/lectures/objectives/examDates/performance/completion/
  reviewedLectures/studyModeByLecture, plus the captured `now`.
  `blockMeta` and `studyModeByLecture` are materialised on purpose — T4.2
  forbids an App closure leaking into the "pure" module.
- `output` — what `buildStudySchedule(blockId)` and
  `generateDailySchedule(blockId, examDate)` returned for that context.

## What these are for

They are the parity contract. `src/shell/logic/schedule.js` (T4.2) must
reproduce `output` from `context` exactly, and that is the hard blocker on
flipping Today over to the shell. **A diff in these files means behaviour
changed** — treat it as a regression until proven otherwise.

## What was trimmed, and why

A raw capture was ~1.5MB per block. Objectives, lectures, performance and
completion keep only the fields the two functions actually read; outputs keep
every decision (urgency, ordering, priorities, intervals, day assignment) but
replace embedded objective objects with `objectiveIds`, since those were just
the input echoed back. `weakConcepts` is stored as per-block counts only —
neither schedule function reads it.

`now` is recorded because both functions call `new Date()` internally. The pure
version takes `now` as input, which is the only way these fixtures stay
reproducible.

## Note for T4.2

`schedule_mrspx2sg9go.json` records a block 34 days from its exam, with 24
lectures, where `dailySchedule.schedule` is **empty** — no day ever gets a task.
That is current behaviour, not a capture bug. Reproduce it first; decide
separately whether it is a bug worth fixing.
