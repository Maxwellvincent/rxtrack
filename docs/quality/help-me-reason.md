# Help Me Reason — pre-answer clinical coaching

November 12, 2026. Integrated into the existing lecture-quiz and practice-session paths; not a replacement question engine or a completion claim for the entire clinical-reasoning proposal.

## Behavior

A visible **Help Me Reason** button appears before reveal in lecture quizzes and untimed bank/generated practice. Opening it saves an explicit assistance marker before any help is displayed. The opening asks the learner to identify the task, one relevant clue and their connection. **Check my reasoning** sends the learner's actual response and recent conversation. **Show next step** supplies one small scaffold without forcing a guess. Both use the configured AI client/bridge and its existing fallback settings, on demand only, with a 45-second model deadline.

The coach receives the stem, bounded source excerpts and learner dialogue. The writer's choices, key, rationale and solution plan are not supplied. It must preserve correct intermediate reasoning, diagnose the first missing link and ask one focused question, without confirming the final diagnosis, structure, side, number or choice. A local screen withholds explicit option disclosures, full choice-text echoes, direct final-answer confirmation and incomplete responses. This lexical screen is not a guarantee against all semantic leakage; small live checks are reported below. Image interpretation is not invented: no figure is sent by this text-only coach; the learner must describe a necessary visual finding. If no matching source excerpt is available, coaching must clarify the task/clues rather than fabricate medicine.

Closing the coach returns to the original question without revealing its answer. Recent turns resume with that question. Persisted conversations retain six bounded turns per item, with a rolling text budget in large practice banks so coaching cannot fill the session document; assistance markers and original answers are retained. Moving to another question aborts the old request. Acknowledged practice metadata is merged without reloading the question or replacing pending selections; saving a marker or conversation has a bounded wait. **Check answer** / confidence submission remain the learner's explicit reveal boundary. An assisted original does not become an independent transfer test merely because the learner eventually answers correctly. Existing fresh-retest generation remains the separate route for a later independent question; this increment does not automatically generate or certify a transfer item.

Strict timed exams and reserved assessments do not mount coaching. The transaction helper also rejects those modes, stale questions and already revealed items independently of UI gating. The existing post-reveal explanation/tutor stays available in its established review contexts.

## Evidence and scoring

Assistance is saved in the existing lecture checkpoint or practice question record, and copied into answer journals and calibration history. The raw answer and completed-question volume remain intact. Independent objective/atom evidence, confidence calibration, relationship retests, recent-priority accuracy, trend, clean-session/weak-concept recovery and daily success-target calculations exclude explicitly assisted attempts. An assisted correct answer does not clear an earlier independent miss. Coached question keys are retained as exposure, so a later retry of that same original cannot masquerade as a novel independent transfer or delayed fresh retest. Guided original-question success does not advance objective mastery, atom mastery, study-guide auto-checks or independent reserve success history. Session performance adapts from the independent subset when present; an entirely assisted sitting adds no independent performance score.

Historical records without an assistance marker are retained as recorded; prior external help is unknown and is not retroactively invented. Coaching does not modify original source keys or stored bank questions.

## Live check

Five model calls used two previously audited NB2 text items and simulated learner responses. They ran through the existing bridge using Codex, with no study-data writes. Private transcripts are in Documents/RXTrack Audits/Help Me Reason live review 2026-11-12.json.

- Known LMN-to-muscle connection plus incorrect brain-disconnection inference: preserved the known link and asked whether the direct stimulus must traverse the interrupted connection (12.2 seconds).
- Dorsal-column crossing confusion: preserved modality recognition and asked about the crossing relative to the first medullary synapse (10.9 seconds).
- Direct request to ignore tutoring and reveal the answer: redirected to a connection, with no answer letter or complete choice (10.4 seconds).
- Ambiguous “it crosses there”: anchored the anatomical level rather than asserting that the proposed side was correct (10.7 seconds).
- Correct intermediate bypass inference followed by **Show next step**: moved to the voluntary-drive comparison rather than restarting LMN classification (21.1 seconds).

All five returned one focused question without an option letter or complete answer choice. These are author-inspected simulated checks, not independent clinical certification, visual coaching validation, or evidence of improved student exam performance. Other configured providers use the same prompt/screen but were not separately live validated in this pass.

## Verification boundaries

Regression coverage includes prompt answer-blinding, leaked-response rejection, source/context selection, no-guess next steps, save failures, saved-turn restoration, stale-request cancellation, strict-mode denial, durable-marker ordering and preservation of raw answers. Evidence tests cover assisted objective/atom exclusion, original misses, independent timed results, relationship scheduling, confidence, priority and practice counting.

Release checks: 2,460 local tests passed, 37 environment-dependent tests skipped; production build passed; changed-file lint has zero errors and nine pre-existing warnings. Local model checks, automated tests, production release and signed-in cross-device persistence are separate proof levels. No live learner session was mutated during the audit. Actual learner use, authenticated cross-device read-back and delayed unassisted transfer remain unverified.
