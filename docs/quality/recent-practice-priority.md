# Recent practice and priority consistency

Priority surfaces reconcile the dated lecture-quiz answer log with learner events and saved/checkpointed exam sessions. The latest 20 eligible answers determine recent accuracy after at least three answers; lifetime totals remain separate. Legacy quiz mirrors with different item IDs can be paired only within the same session/lecture, matching outcome, and a unique 10 ms timestamp match. New quiz mirrors share event identity, canonical question key and timestamp.

The sprint ranks demonstrated gaps below the 80% target and substantial objective coverage gaps. A recovered lecture is not assigned a broad repair block merely because lifetime accuracy remains lower. Explicit unresolved objective gaps remain eligible independently of aggregate accuracy.

Saved quiz history can restore absent learner events on Today/Exam hydration. Only current, explicitly recorded lecture/objective links are admitted; no topic matching or mastery inference is performed. Recovery is idempotent and quality exclusions remain respected. History publication uses a Firestore transaction so a stale cached snapshot cannot replace newer answers.

Persist only baseline, original event journal and non-replayable metadata for the evidence record. Objective/lecture/atom/task/order aggregates are rebuilt on read rather than duplicated in the same size-limited document. No source answer history is truncated. This reduces current storage pressure; it does not make one-document history storage unlimited.

Regression checks cover a recovered 17/20 quiz against stale 2/8 evidence, unchanged cumulative totals, duplicate mirrors, explicit-link recovery, concurrent server history, and stored-event preservation.
