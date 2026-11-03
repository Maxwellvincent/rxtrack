# Reserved timed assessments — phase 6

## Workflow

Exam → Question banks → Assessment setup reuses the existing reservation control, collapsed by default. Reserve a keyed source to exclude it from generation examples. That bank then offers **Reserved timed assessment**, with separate result links rather than mixing assessment percentages into ordinary bank practice history. Existing practice records are retained.

Assessment launch validates complete questions and stored figure-only crops. It reads full account exam-session history across blocks, then transactionally checks current reservations and saves a versioned exposure snapshot before creating the session. A failed history read or registry write prevents launch. No model call is made. Loading history happens before the timed budget begins. Timing remains 90 seconds per question; the original deadline continues through save/exit and resume.

## Exposure and integrity

The registry tracks exact normalized content identities, source aliases and preparation-context use. Historical sessions conservatively count assigned questions as prior exposure, even if the learner never answered them. Assessment delivery attempts are retained across interrupted launches and session deletion. A retry with the same session ID is idempotent; separate sessions remain separate attempts. Reservations and exposure are never evicted to make space: the storage-size guard stops before an oversized update.

Unrecorded historical, external and semantic/paraphrase exposure remains **unknown**, not unseen. Reservation cannot retroactively make studied material fresh. The snapshot records item identities, source-key digests and saved-figure digests. Later edited or incomplete snapshots are excluded from school-result pairing. This is software integrity metadata, not medical correctness certification or a proctored exam.

## Runtime and scoring

No answer reveal, reading cue or objective hint is offered during the timed assessment. Figures use the frozen saved crop, without PDF-page browsing, live crop edits or diagram-label repair. Full pages may contain keys and are rejected at preflight when a required saved crop is missing. A saved crop is not automatically certified free of annotations.

Save & exit persists picks and position without publishing partial correctness or learner evidence. Submitted assessments retain ordinary scored-answer evidence for study totals; their assessment score separately includes unanswered valid items in the denominator. Quality exclusions are removed explicitly. This does not turn unanswered questions into fabricated answer events.

The separate submitted report presents the overall score, exposure counts, lecture percentages and collapsed objective percentages. Missing links are explicit. Questions may contribute to multiple objective rows, so those rows cannot be added together. Ordinary practice continues to use its existing answered-only scoring.

## Prospective school comparisons

The existing School alignment & exam comparison panel adds a collapsed reserved-assessment series. It pairs submitted same-block assessments with actual school results from the prior seven days, excluding exam-day practice. Known-exposed or repeat sittings are omitted from this comparison and counted as omitted; their individual results remain accessible. Unknown exposure remains unknown in the comparison. Duplicate session IDs, changed question/key/figure snapshots and non-assessment sessions do not enter the series.

No predicted mark, pass probability, confidence range or calibration claim is produced. Representative content review and sufficient prospective comparable school outcomes are still needed.

## Validation boundary

Automated suite: 2,303 passed / 37 skipped. Focused launch/runtime/report/exposure/comparison tests cover failure paths, retakes, unanswered scoring, quality exclusions, save/resume secrecy and figure controls. Production build, changed-file lint and patch checks pass. The recurring launch-test cloud-hydration race was isolated with a deterministic registry mock; production fail-closed behavior is unchanged. Two existing question-state reset effects were replaced by keyed child state while preserving question-change reset behavior.

No real source reservations, assessments, learner answers or school results were created by this implementation run. Signed-in end-to-end persistence, representative source/figure review and prospective learning/calibration outcomes remain pending.
