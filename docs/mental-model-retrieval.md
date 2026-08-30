# Mental model retrieval

Anki schedules atoms. RXtrack schedules models. Questions test integration.

## Use

Today → Today's Retrieval → Model library → Add mental model.
Give the model a title and a reconstruction prompt, optionally linking a lecture/topic,
subject, tags and reference notes. References can be pasted or include an external notes link.
Alternatively, open a lecture and choose **I created my mental model**. This explicitly
confirms your own model and enrolls that lecture in retrieval, even if you built it
in chat or on paper. Optional pasted notes take precedence over the lecture's saved
big-picture reference. Repeated confirmation never duplicates the model or resets
its review history. AI reference generation alone does not imply you created a model.
Two new lecture models per weekday are supported without raising the daily budget;
new models and repeat retrievals share the same capped queue.

Start retrieval, reconstruct on paper/aloud/in the optional scratchpad, acknowledge
the attempt, then reveal/check. Grade Broken, Shaky or Solid. Saving advances to
the next selected model. No more selected models means done for today.
The scratchpad is disposable and is not saved as part of the reference.

Model library contains editing, reference notes, status, review history and Review now.
Review now also respects the daily budget. Reopening a reference is not a graded review.
Retesting, not model grades, continues to clear existing atom/objective flags.

## Data and persistence

New private key: `users/{uid}/kv/rxt-model-retrieval-v1`, using the existing `data`
wrapper. Contains version, global settings, and models indexed by unique ID.
Models contain blockId, lecture/topic text, subject, title, prompt, reference, tags,
importance, estimated minutes, creation/last/next timestamps, status, solid streak,
retrieval history and linked evidence. No existing atom, Anki or exam records change.
Signed-in mutations use a Firestore transaction; simultaneous grades recheck the
latest global daily budget. A network failure leaves the review open for retry.
Signed-out usage follows the existing local storage pattern.

## Scheduling

- New: eligible now (same-day enabled) or after 24 hours.
- Broken: Learning, next day, reset Solid streak.
- Shaky: Shaky, three days; consecutive Shaky grades shorten to two days.
- Solid: seven days, then fourteen, then thirty. Two spaced Solids indicate Stable.
- Fourth or later spaced Solid after at least thirty days since the previous
  successful retrieval releases the model from routine selection.
- Early Solid reviews do not accelerate the streak or extend the scheduled date.
- Released models remain in the library and may be reviewed manually.

## Budget and priority

Default ten planned minutes, maximum four model retrievals per local calendar day.
Settings support 5/10/15/20 minutes and 1–4 models. Spending includes history across
all blocks, not just the block on screen. Selection is block-specific. Reviews from
missed days do not accumulate extra daily obligations. No overdue counter is shown.
Minutes represent the estimated task size, not actual stopwatch duration.

Score = weakness × recency × exam proximity × importance × struggle adjustment.
Weakness weights: New 2, Learning 4, Shaky 3, Stable 1.
Recency grows up to 4×; future exam proximity up to 4×; importance 1–3.
Seven-day explicitly linked failures increase priority; successes reduce priority.
Highest scores that fit the remaining time and item limits are selected.
Optional Saturday cumulative retrieval is off by default and obeys the same limits.

## Evidence hooks (automatic adapters not connected)

`recordRetrievalEvidence(userId, modelId, {id,type,at,sourceId})` accepts explicit
model IDs and deduplicates event IDs in the retained evidence window (200/model).
Types: question-success, question-miss, anki-again, anki-success, manual-confirmation.
Questions and Anki each have an enable setting. Weakness reopens a Released model;
success lowers priority but never claims full relationship retrieval or clears flags.
Automatic mapping to missed questions/objectives and Anki tags is deliberately not
implemented: lexical overlap alone is not sufficient evidence of a model-level test.
AI prompt generation is not used; the retrieval flow consumes no AI credits.

## Verification

Engine tests cover empty queues, large backlogs, budget exhaustion across blocks,
skipped days, exam proximity, early reviews, repeated grades, release/reopening and
optional evidence. Component tests cover reference hiding, attempt-before-reveal,
successful save and advance, close-without-grade, budget blocking and save failures.
For manual verification, add two models, grade one, confirm the second opens with
its reference hidden, then reload and inspect history. Change blocks to verify
that the daily budget is shared. Verify atom flags and exam scores remain unchanged.
