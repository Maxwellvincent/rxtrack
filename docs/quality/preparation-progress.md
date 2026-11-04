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
