# Delayed fresh relationship practice

Phase 4 continuation, November 2, 2026. This is conservative scheduling infrastructure, not a mastery or exam-score model.

## Rules

Current-source, parent-scoped relationship events are derived from the quality-filtered learning journal. Creating a relationship record adds no answers. Missing, invalid, future-dated or unscored timestamps do not establish a delay. Historical events without explicit relationship IDs remain unassigned.

- Unanswered registered relationships are unseen.
- A miss is due for repair. A repeated success on the same question cannot clear the fresh-repair requirement; a fresh successful question can.
- After first exposure, a fresh retest is scheduled after 24 hours.
- A delayed success needs a new question identity, a different nonempty session identity and at least 24 hours after the preceding qualifying anchor. Several new questions in one follow-up sitting cannot manufacture multiple spaced successes.
- Verified second/third-order delayed application extends the heuristic interval to three days, then seven after another spaced application success. Recognition is recorded separately and does not earn that extension. A new miss resets spacing.
- Repeated successes never postpone a fresh retest. Unknown session identities cannot establish delayed success.

These heuristics do not prove semantic freshness across paraphrases or transfer to a different clinical presentation. `transferStatus` remains `not-assessed`. A distinct stored question key is necessary but not sufficient evidence of semantic transfer. Existing repetition, source, depth and independent review safeguards remain in force.

## Integration

The shared relationship target planner prioritizes repair, due retests and unseen registered relationships, balancing parent objectives and omitting relationships still waiting or requiring figures. Both objective and direct lecture quiz preparation already use that planner. The prompt asks for a genuinely fresh supported context and retains the parent objective/depth. Previous keys in prompt context are capped at eight. This is relationship-target selection, not a guarantee that every other quiz slot avoids every previously practiced fact; the inventory is partial.

Lecture Progress displays a compact Fresh retests summary. Waiting dates refresh while Progress is open. Existing diagnostics show per-relationship scheduling state. No new practice-screen administration, learner records, source reimports or storage migrations are required.

## Verification

Tests cover 24-hour boundaries, different sessions/keys, repeated answers, same-sitting inflation, recognition/application separation, post-miss spacing reset, current-source targeting and a compact UI summary. Full suite: 2,263 passed, 37 skipped. Build and scoped lint pass (pre-existing lecture-component warnings remain). Signed-in save/reload and fresh live question-quality evaluation remain deferred; no model call or user-study mutation was performed for this implementation. Full semantic-transfer assessment and phase-wide learning outcomes remain open.
