# Shared generated-question contract

Implemented November 2, 2026, as the next phase 3 infrastructure step.

`src/engine/questionContract.js` defines the versioned factual, objective, reasoning, choice and admission rules used across full/compact drafting, atom drafting, independent review, repair and saved-question reuse. School templates govern construction; lecture evidence governs facts. Existing source-bank originals and historical answer evidence are not rewritten.

## Changes

- The key-hidden solve now runs before any key-aware review request in a new review invocation. It receives only final stem, choices and source evidence. A mismatch still rejects the question; it never silently changes the writer's key. Repairs enter the same review path.
- Current reviews carry contract metadata and the new `2026-11-02-blind-first` policy. Older-policy questions need current review before admission to a new generated set; historical results remain intact.
- Complete school-supported option patterns take precedence over a five-option default. Aggregate option-count statistics are guidance, not exact acceptance quotas. Repairs preserve complete supported counts/layout unless fixing the reported defect requires a change. Correct medical keys are not adjusted for letter balancing.
- Generated-choice normalization and rendered style examples support A–Z, removing the previous A–H ceiling. Tests preserve fourteen options through N and the keyed answer after presentation shuffling.
- Shared basic admission checks reject missing stems, invalid keys, incomplete/noncontiguous options, exact duplicate choices and multiple primary objectives in both reviewed results and reuse. These structural checks do not certify medical correctness; independent source, reasoning and discriminator checks remain required.

## Verification limits

Automated regression tests verify prompt consistency, request ordering, withheld writer material, disagreement rejection, long choice patterns and old-policy reuse exclusion. Full local suite: 2,248 passed, 37 skipped. Production build and changed-file lint pass. This is a software-contract improvement, not fresh medical content evaluation or proof of learning outcomes. Live model and signed-in checks remain deferred. Full phase 3 exit criteria still require representative content review, including visual/table questions, and the later original phases remain open.
