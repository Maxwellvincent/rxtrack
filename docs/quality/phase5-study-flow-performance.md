# Phase 5: study flow, measured projections, and persistence checks

November 13, 2026.

## Consolidation

Practice now owns the canonical recent-concept/repair continuation. Progress retains its trend, objective evidence and combined slides/notes review. An unfinished quiz takes precedence over a second repair continuation; the newest saved quiz is prominent and older sessions remain behind one disclosure. Legacy round-bookmark reset moves to Sources & tools and is named accurately; it does not reset answers or readiness. A repair report uses one concept list and one continuation rather than duplicate concept headings/actions.

Lecture panels mount their tools on first visit, then remain mounted to preserve unsaved previews and drafts. Sources, retrieval enrollment and progress-chart work no longer initialize solely because the lecture opened in Practice. The existing guide/notes/tutor tools remain accessible.

## Performance

`scripts/profile-study-flow.mjs` uses 12,000 synthetic answers, 320 objectives and 80 lectures, without account I/O or model calls. The repair projection changed from approximately 56.17 ms to 4.36 ms median; lecture reconciliation changed from 3.92 ms to 1.65 ms. Output SHA-256 digests were identical before/after for both projections. Later warm repeats vary; this measures those calculations, not whole-page load speed, heap use or elimination of intermittent browser/GPU screens.

Independent startup reads for state, objectives, lectures and KV presence now run concurrently, rather than adding three sequential collection-read round trips. Merge/write behavior and the empty-account guard are retained.

Objective answer events are indexed once instead of rescanned once per objective. Lecture membership checks use a set. Expensive priority/history projections are memoized on their immutable inputs. A shared minute clock updates due-time planning and refreshes on new evidence/focus without refetching cloud data or creating one interval per card; tests verify cleanup and retained drafts.

## Persistence checks and fixes

All 35 local Auth/Firestore/Storage emulator checks passed, including permissions, prepared-question assignment, session save/read transactions, resume-safe finalization and cross-device-style pull/push. These use disposable demo accounts and do not establish a new production account write/read round trip.

Two real defects surfaced: legacy cloud pulls delegated their local mirror update to account-store `write(null)`, which intentionally does nothing; mirror writes now explicitly use the local JSON adapter after the confirmed cloud operation. Weak-concept reconstruction now filters question source blocks, so a reused lecture ID cannot combine NB1/NB2 history. Two stale transaction-spy expectations were updated to assert the existing event-id argument, and test fixture question blocks were made consistent with their enclosing session.

## Bounded live question review

Private outputs remain under Documents/RXTrack Audits; no generated questions or answers were saved into study progress. The historical reference inventory contains 525 homework, 45 ExamSoft, 11 IMCQ and 18 in-class examples. This is a source pool, not proof each draft used every source kind, not an unseen holdout, and not proof that NB1 ExamSoft/IMCQ references are NB2 factual authority.

The initial NB31 run admitted 2/3 in 112 seconds. Manual review found a weak closest-rival explanation; review now copies the actual alternative before comparing it, and rejects a supplied alternative text that differs from the option. An explicitly third-order NB31 run admitted 2/2 in 72 seconds but manual review found parallel somatotopy lookups rather than a dependent chain. A narrow regression now withholds that observed pattern as third-order, including on reuse; it does not ban legitimate second-order localization or certify all other third-order claims.

NB40 admitted 0/2 in 80 seconds; its reviewer claimed approval despite a disconnected chain in one item and insufficient reasoning steps for claimed third-order in the other. Structural reasoning failures now receive depth/connection repair feedback instead of being counted as an unavailable source reviewer. Actual ungrounded-source failures retain their conservative boundary. NB28 admitted 1/2 in 59 seconds, withholding an option shortcut. Its retained case applies premedullary dorsal-column laterality to a new examination finding.

The follow-up NB31 repair audit withheld both items and ended at its 240-second budget; the attempted replacement failed objective/depth/explanation/duplicate checks. This is a failed preparation check, not a successful third-order set. The known parallel lookups cannot now enter as third-order. Lower-level objectives also no longer get an impossible third-order delayed target: they receive fresh second-order application, while objectives whose scope allows integration retain third-order retests. These bounded checks and software regressions do not close representative visual/table review, genuine next-day learner transfer or prospective score calibration. Existing original-bank keys and historical grades remain intact.
