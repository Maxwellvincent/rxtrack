# Phase 5 continuation: live lecture counts, measured projection cost and NB35 source repair

November 3, 2026.

## Count consistency

Lecture Study previously captured its question statistics once on mount and refreshed them only on quiz exit. The PowerPoint review log subscribed live, so cloud hydration or another-device updates could leave two parts of one lecture disagreeing. Both now use the same reactive per-lecture selector. Readiness waits for raw totals, checkpoint evidence and exclusion ratings to hydrate, and dependency errors surface as incomplete history. This does not infer lecture attribution for unassigned manual practice. The lecture-list aggregate is labeled “lecture-linked answers” to distinguish its scope from block-wide Practice pulse.

Immutable snapshot projection is reused only while raw counts, answer evidence and ratings identities remain unchanged. Updating any input invalidates the projection. No counters, dates or persisted history are rewritten by this optimization. Tests cover remote hydration, mounted updates, pending checkpoints, cache invalidation and error propagation.

## Measured performance

`node scripts/profile-lecture-stats.mjs` profiles 5,000 synthetic pending events across 40 lectures, using an in-memory cloud backend with writes disabled. Fifty warm reads took approximately 158.55 ms before projection reuse and 0.12 ms afterward, with 5,000 answers preserved. The raw measurement is in `profiles/lecture-stats-2026-11-03.json`. This isolates one projection; it is not page-load timing, signed-in production profiling or a claim about whole-app speed.

Unused command setup, round-bookmark calculation and an unused metadata import were removed after caller inspection. Existing study tools, saved models, notes and history remain intact.

## NB35 source defect

Local PDF text and the rendered objective page confirm six NB35 objectives, including a letter-prefixed final code `M0184`. The coded-objective parser previously recognized only five and merged that objective into the preceding denervation row. It now retains optional letter-prefixed four-digit suffixes, exact code spelling and the source's NB1 prefix on the conduction objective.

Already imported rows containing an adjacent source code can be repaired only when their wording begins with the clean, explicit same-code source objective. The practiced ID, notes and counters remain intact, the prior wording is retained as provenance, and the missing objective gets its own source record. Manual alignment is respected. Repair is idempotent and uses the existing source-link repair path; no reimport or historical grade reassignment is required.

## Approved NB35 smoke test

The user approved three live questions through the existing bridge. The corrected six-objective extraction allocated three tasks: conduction measurement, denervation/reinnervation and acute demyelination. All three passed the current source, ownership, depth, discriminator and key-hidden solve checks, in approximately 119 seconds. No app questions or progress were saved.

No NB35-matched school examples were available locally; this was lecture-only generation, not school-style matching or production preparation end-to-end validation. Manual reading found the denervation item too obvious despite automated approval. Therefore 3/3 automated acceptance does not establish uniformly good Step-style difficulty or close the content-quality phase. Full private results and findings remain outside the repository under Documents/RXTrack Audits.

## Release checks

Full local suite: 2,267 passed, 37 skipped. Production build and scoped lint pass (pre-existing hook warnings remain). Signed-in persistence, full production page timing, broader source-mix/visual quality and prospective exam-score calibration remain separate pending proof levels.
