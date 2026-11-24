# School-aligned question generation + Adaptive Diagnostic Mode

**Status:** in progress. Ticket status is kept in the table at the bottom.
Decisions came from a grilling session on 2026-11-24 (NB 2 = 70%, now preparing NB 3).

## Goal

Questions generated for **lecture quizzes** and **exam practice** must be:
accurate to the lecture text and slides, worded and pitched like SGU school
questions, and weighted toward what the school actually tests. Then an
Adaptive Diagnostic Mode (B) grades reasoning separately from accuracy.

## School assessment scopes

| Format | Content span | How RxTrack scopes it |
|--------|--------------|-----------------------|
| Homework | one week, several lectures; lecture titles inside the PDF | already split by lecture heading (`130911f`) |
| IMCQ | multiple lectures within one week | style/factual evidence |
| ESoft quiz | ~2–3 weeks (varies) | style/factual evidence |
| NB main exam | block range (NB 3 = lectures after NB 2) | exam practice, block blueprint (`bpmBlueprint.js`) |

One shared style profile (no per-format split).

## Locked decisions — Part A (generation)

1. **Priority within a subject share**: school frequency first (count of uploaded
   school questions tied to the objective by exact `SOM…` code or stored link),
   NB weak-category evidence second (already feeds lecture allocation via
   exam-report weak concepts), slide emphasis only as a tie-break.
2. **Accuracy gate**: every lecture-quiz and exam-practice item keeps the
   key-blind source solve + objective ownership checks (already enforced via
   `requireBlindKeyCheck` in `quizLaunch.js`). A shortfall is preferable to a
   wrong item.
3. **Choice format**: allow 4–8 choices and laterality/modality grids when the
   matching school template uses them; the prompt must not imply five choices.
4. **Cross-lecture items**: 25% of an exam-practice set, drawn only from the
   selected range. Each needs one quoted rule from each of two lectures, joined
   through a shared intermediate, both rules necessary (deletion test).
5. **Format fit**: compare each item with the matched templates; flag low fit in
   diagnostics (not silent).

## Locked decisions — Part B (Adaptive Diagnostic Mode)

- Free-text explanation (short prompt: decisive finding, what it means, why not
  the closest alternative) required before the key is revealed.
- AI grader (DeepSeek-first route) sees key, lecture excerpts, explanation.
  Scores dimensions separately; every K/C/M/R/D/Q/A/E code must quote the
  learner's own sentence, otherwise the dimension is "not demonstrated".
  Reasoning grade never changes exam score or accuracy.
- One dispute → one re-grade; both versions kept.
- The 8-level ladder (identification → function → mechanism → forward →
  reverse → discrimination → transfer → retention) is the item's task type;
  first/second/third order remains depth within a level.
- Learner stages Exposure → Recognition → Recall → Mechanism → Application →
  Discrimination → Stable run beside the existing 80% rule. Advance only on
  independent, graded reasoning; never on one correct answer, elimination or an
  assisted attempt. Stable requires a delayed retest.
- Remediation ladder: isolate the missing link → reverse direction → add
  complexity → unscaffolded transfer → delayed retest; step down to
  prerequisites after repeated struggle.
- Exam mode unchanged: timed, no hints, no confidence input; diagnosis after.

## Tickets

| # | Ticket | Status |
|---|--------|--------|
| A1 | School-emphasis ranking of objectives (exact code / stored link counts) in lecture-quiz and exam-practice objective plans | **done** (`engine/schoolEmphasis.js`) |
| A2 | Choice-format contract: 4–8 options and grids when templates use them | **done** (`QUESTION_CHOICE_CONTRACT`) |
| A3 | Cross-lecture integration items in exam practice (25%, two-lecture two-rule check) | **done** (`exam/crossLecture.js`); live yield unmeasured |
| A4 | Format-fit flag in generation diagnostics | not started |
| B1 | Diagnostic session: explanation-before-reveal + reasoning grader contract | not started |
| B2 | Error taxonomy with quoted evidence + dispute re-grade | not started |
| B3 | Learner stages + remediation ladder driving the next item | not started |
