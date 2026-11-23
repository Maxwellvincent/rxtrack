# Objective connection map — November 23, 2026

## Delivered flow

Lecture → Learn builds a cached connection map in two-objective batches. Each objective gets independently reviewed, source-located teaching connections where the original supports them. Each card includes a concise relationship, an open self-explanation prompt, teaching text, a source quotation/page and optional prerequisite connections. Long objective lists stay collapsed; Practice links to the map. A failed batch stops with an explicit retry and preserves previously saved batches. It does not run on each question or create learner answers.

The map uses the existing account-backed relationship catalog (`rxt-source-relationships-v1:<lectureId>`), rather than another competing progress store. Source versions and objective signatures invalidate stale maps without deleting the historical records. Source questions and grades are unchanged. Model-facing objective aliases resolve exactly to existing IDs; invented IDs and reconstructed quotations receive no connection.

## Evidence and question targeting

The existing independent/assisted answer journals drive per-connection scheduling. An answer needs the exact objective, lecture, block, reviewed connection ID and source version. Older broad objective scores do not become specific connection credit. Assisted attempts remain visible without independent success. Repeating the same item cannot repair a fresh-transfer requirement. Current untested/repair/due connections keep a broad “ready” objective in the practice plan.

Connection practice starts with a fresh second-order application. Delayed practice can request third-order integration when the parent scope supports it. All existing source, objective, answer, ambiguity, freshness and reasoning checks still apply. Focused generation/reuse cannot silently substitute a different connection. The shared question engine uses registered connections in its allocation; no extra model call decomposes the objective for each quiz.

Full, compact, local and blind-source reviewers now receive an explicit connection catalog. `C1` references are connection ownership; `E1` references remain source evidence. Independent review resolves C references back to durable IDs. Writer claims or copied source citation IDs cannot grant connection credit. After reveal, lecture and exam runners expose the linked teaching connection behind one optional disclosure. No teaching card is shown before the answer is revealed.

## Inspiration and boundaries

The supplied NARQB video-sales page was inaccessible through web retrieval. Its public `/usmle` page describes connected concept sequencing, mistakes returning from new angles, and spaced review. This informed the connected study flow, not copying proprietary questions, making outcome promises, or using marketing as medical authority.

A map is a reviewed partial source inventory, not certification that every concept in a broad objective was exhaustively decomposed. Figure-dependent connections require visual review and cannot enter text-only practice. Reading or self-explaining a card does not establish scored mastery. Unsupported source extraction remains unresolved rather than being repaired with invented facts.

## Checks

Regression tests cover exact source/parent placement, prerequisite cycles and rejected parents, stale-source invalidation, assisted and repeated attempts, no inheritance from broad scores, focused question reuse, provider failure without request loops, cached UI behavior and disclosure timing. A disposable Auth/Firestore emulator account verified a real map save/read round trip without generating learner evidence. Private live audits use previously approved NB31 text, ephemeral storage and files in Documents/RXTrack Audits; they never alter account questions, answers or progress.

Live audit findings: the initial draft reconstructed text across interleaved PDF columns; a subsequent draft mistyped a UUID. Contiguous quotation instructions and exact short objective references address those observed errors without weakening source validation. One recheck produced two reviewed NB31 connections. A subsequent mapping review correctly withheld a proposed set; the independent reviewer was also corrected to judge necessary component connections rather than requiring every component to fulfill the entire broad objective.

A bounded map-to-question run admitted 1/2 questions in 20.2 seconds through the configured Ollama Cloud fallback; another question's reasoning route was withheld. This exposed citation IDs being returned where connection IDs belonged, which led to the explicit C/E separation and regression checks. A corrected simulated delayed-target audit requested one third-order item and admitted none in 3.3 seconds through the alternative blind-source review path. This is evidence of rejection, not successful third-order clinical validation or actual learner retention. Provider output can still yield a preparation shortfall; the app does not lower its checks or invent coverage to fill a set. The regular production policy and the alternative blind-source policy are distinct.

Final builder check: 3 source-located, independently reviewed NB31 connections returned in 4.6 seconds via the configured Ollama Cloud fallback. The connection-ownership recheck admitted 1 of 2 fresh application questions in 20.2 seconds and withheld the other reasoning route. The separately labeled simulated delayed/third-order check admitted 0 of 1; it does not validate third-order yield or real next-day learner transfer. No synthetic answers entered the user's account. The implementation schedules and verifies supported second-/third-order targets; these bounded audits are not proof of uniformly successful generation.
