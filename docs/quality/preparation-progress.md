# Lecture preparation progress and retry bounds

Lecture preparation retains its shared ten-minute ceiling and independent accuracy, objective, and reasoning review. Three consecutive completed rounds that add no accepted questions now stop new dispatches, even when recovery waves are enabled. Already-running batches drain within the shared deadline and may still add valid items. Acceptance resets the empty-round counter. Saved questions and the existing missing-slot retry remain available; this is not a promise that every requested slot can be filled.

Live progress includes active draft and review calls, excluding completed calls. The active quiz displays the accepted ready count and current stages. No unreviewed draft increments readiness.

Validation: focused routing and preparation tests cover the no-progress bound, live call events, stage labels, existing concurrent merges, deadlines, and partial preservation. Production asset verification does not prove a complete signed-in 20-question model run or a latency improvement under live provider load.

## Tracking and review failures

Source registry mutations from this tab are serialized per user while retaining server transactions and fresh reservation reads. A confirmed source-tracking failure stops new dispatches and remains the reported reason after other in-flight jobs finish. Nothing bypasses exposure persistence or sends reserved examples on a storage failure.

Batched reviews now receive the same single correction opportunity as single-item reviews when an otherwise approved, grounded review omits objective-ownership fields. The unchanged question is reviewed again; a genuine objective mismatch is not repaired by forcing its assigned ID. Every accepted item still passes the existing factual, ambiguity, reasoning, and blind-solve gates.

Blind-solve transport failures and incomplete strict review service responses preserve provider failures rather than converting them into question defects. Valid questions already independently approved remain available. Quality shortfalls include the leading review-outcome categories; counts represent review outcomes and can include repeated review rounds.

Incident evidence: the pasted console contained local mirror exhaustion and Firestore failed-precondition writes, not HTTP 429. Historical bridge logs separately confirmed Codex usage limits followed by Ollama Cloud HTTP 429. The latest observed bridge requests were again succeeding on Codex. An exact-content transaction confirmed the existing 2,392-item registry (about 465 KB) can be saved, without changing its source reservations or study history; this does not establish the cause of the earlier client failure. No index or storage-size cause was inferred from the error code alone. Browser persistence and a complete live 20-question generation remain separate verification steps.

The provider route marks an already-exhausted cloud fallback so the outer MCQ router does not invoke it a second time. When Codex is limited and the configured cloud route also fails, both causes remain in the preparation error. This does not provision another provider or change models.

## Reducing generation latency

The lecture route now prepares one initial candidate, opens the quiz after the first independently accepted question, and appends subsequent accepted questions into the same session. Existing session answer state and the requested total remain intact. Rejected starters do not open a quiz. Saved partial quizzes skip the special starter request.

Two candidate batches can progress concurrently on Codex. Independent blind solving and editorial review overlap after a draft, and acceptance waits for both verdicts. Blind prompts still exclude the proposed key, rationales, plans, history, and editorial verdict. A shared preparation gate permits at most three provider calls across active lecture preparations across drafting, solving, editorial review and repairs, falling to one while Codex is usage-limited. Queue time consumes the original deadline; cancelled queued calls never reach the provider.

Normal batches no longer request two spare drafts for every three slots. Spares are limited to small final refills, with the existing focused one-item recovery path preserved. This avoids routinely writing and reviewing five candidates throughout a long quiz.

An identical duplicated school-calibration contract and repeated choice-contract block were removed from the compact writing prompt. All source evidence and examples remain available. A local NB35 lecture-only fixture fell from 38,207 to 35,771 prompt characters (6.4%); this is a fixture measurement, not a model latency claim.

Controlled tests verify concurrent independent calls, rejection on blind-key disagreement, no early acceptance, bounded provider concurrency, queued cancellation, one-item starter allocation, and preservation of appended quiz state. With synthetic independent review delays of 30 and 50 ms, the review critical path becomes 50 rather than 80 ms. No claim is made that live provider latency or a full 20-question completion improved by that percentage. Live provider response and acceptance yield remain separate constraints.

## NB37 timeout investigation

Local replay of the 2026-11-04 NB37 run found six editorial approvals. Applying the recorded independent blind verdicts and evidence checks explained why only two were admitted: some blind checks cited extracted-only notes, another reported a shortcut, and another could not establish a unique answer. Several other drafts were explicitly rejected for unsupported facts, recall-level tasks under an application target, or objective mismatch. These are not 18 accepted questions lost by the UI.

The blind catalog previously offered extracted facts even when its validator required every citation to occur in the original lecture. It now offers only retrieved original-lecture spans when an original lecture of sufficient length exists. Extracted-fact evidence remains available in atom-only mode. The validator and source-grounding requirement are unchanged. A model must independently produce a new valid verdict; old rejected questions are not silently reclassified or credited.

Lecture preparation gives the inner engine five seconds to finalize before the unchanged outer ten-minute guard. If the outer deadline still wins, the job result retains accepted callbacks, request/rejection metadata and the leading review outcomes. In-flight drafts are never promoted. Retained progress marks interrupted calls cancelled at the client boundary, which does not claim the remote provider stopped executing.

Unit and replay checks are separate from a live provider recheck. The proposed two-question NB37 recheck was blocked by automatic approval review pending explicit authorization for that material and destination; it was not sent. No private lecture text, stems, model outputs or user identifiers are committed here.

After explicit user approval, the two recorded NB37 candidates were rechecked through the same Codex bridge with the original-lecture-only catalog. The request completed HTTP 200 in 19.86 seconds. Both blind answers matched their recorded keys, supplied original-lecture evidence, and passed the current blind-route validation. Results remain in the local audit folder and no study records were changed. This verifies the narrowed citation path, not full 20-question generation, independent medical certification, or a population-level latency improvement.
