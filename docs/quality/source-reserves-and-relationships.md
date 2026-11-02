# Evaluation reserves and source-backed relationships

These implement the next two infrastructure steps of the original improvement plan. They do not close the six-phase plan or establish exam-score prediction validity.

## Evaluation sources

More → Admin diagnostics → Evaluation reserves & exposure provides collapsed source reservation controls. Import also offers a collapsed evaluation setting. Reservations persist before imported originals, exclude matching content aliases from automatic generation, template/style calibration and automatic exam selection, and preserve originals for direct practice. Releasing a reservation retains exposure history.

Preparation rechecks the cloud registry transactionally before model invocation and records available preparation context. A failed write stops that generation. Derived styles are rebuilt from allowed examples. Exposure records contain content IDs and timestamps rather than question text. Prior exposure is unknown, never presumed unseen; this is not learner-exposure tracking or proof that a model consumed every supplied example. Reservation cannot undo an already-started model request. Imported-image OCR may still require the existing vision service; reservation concerns subsequent teaching/generation/calibration use.

## Objective relationships

More → Admin diagnostics → Source-backed objective relationships allows inspection and explicit source registration. Records retain the block, lecture, parent objective, exact objective clause, source quotation, page and source version. Their IDs survive display-label edits. Partial inventories do not establish complete objective coverage.

Reviewed objective and lecture quiz generation can register source-located relationships only after current independent question review, an explicit parent clause and a located source quotation. Writer-supplied IDs alone earn no credit. Matching text establishes provenance, not medical certification or guaranteed semantic equivalence across paraphrases. Figure references remain excluded from text-only targeting pending visual review.

Answered questions carry relationship IDs and the source version into the evidence journal and answer-history recovery. Only matching current-source, parent-scoped answer events count. Creating records adds no answers. Old events are not retroactively inferred from terms or labels. Source replacement invalidates old bindings while preserving historical records. Repeated answers to one question update its outcome rather than multiplying distinct-question coverage.

## Validation boundaries

Local tests cover content-alias reservations, concurrent transactional writes and failure handling, final generation-context filtering, source/parent/version validation, explicit answer evidence and collapsed controls. Build and deployment are separate checks. Signed-in persistence and fresh live question-quality evaluation remain deferred at the user's request. No learner data or external model test was generated during implementation.
