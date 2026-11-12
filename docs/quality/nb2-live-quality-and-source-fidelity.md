# NB2 live quality review and source fidelity

Updated November 12, 2026. This is a bounded correction pass, not completion of all quality-plan exits or the proposed clinical-reasoning upgrade.

## Confirmed defects and corrections

- Generic phrases such as “associated with” and “connections between” assigned unrelated school examples to cerebellar objectives. Template matching now requires substantive topic evidence; wrong-choice mentions cannot establish a source concept match. Exact codes/stored links remain candidates requiring semantic review.
- Duplicated stems and appended objective inventories contaminated some IMCQ prompt examples. Prompt-only cleanup preserves the original bank and never infers an absent key.
- Independent review initially approved a descriptive-clue shortcut and overstated paired neuron classification as third-order. Shared writing/solve/repair instructions now test observation necessity; a regression guard rejects the observed paired-label third-order pattern. Reviewer assertions remain fallible, not semantic proof.
- Marked MRI/CT exhibit dependencies now use the shared visual-dependency screen rather than an incomplete duplicate expression. A self-contained imaging finding remains a valid text task; a question asking about an unattached marked section does not.
- Week 14 behavioral-science chapters restart question numbering in question and answer copies. The old document-wide parser produced 18 items and misassigned a later chapter's key. A deterministic titled-section adapter reuses the existing strict source/key reconciler. Real section titles and original PDF page locations are retained; synthetic internal grouping is never exposed as a lecture assignment.
- Bank actions formerly squeezed the text into a tiny flex column. Cards now stack content above a wrapping action row.
- Saved figure crops already persisted, but navigation controls remained displayed. Saved crops open automatically with navigation hidden until editing. Explicit diagram-label confirmation is now merged into the same account-backed record and reapplied on future bank launches, without deleting the crop, shrinking a longer verified grid, rewriting text choices, or inferring labels from a key.

## Live evidence and limits

Private account sources and generated content remain outside Git under Documents/RXTrack Audits. The retrieved eligible text pool contained 525 homework, 45 ExamSoft, 11 IMCQ and 18 in-class examples, excluding reserved/figure-dependent items. Homework/in-class NB2 examples were present; ExamSoft/IMCQ references came from NB1 and were not presented as NB2 source facts. This is exposed historical material, not an unseen holdout.

Initial live runs: NB28 3/3 accepted in 74 seconds; NB31 2/3 in 90 seconds. Editorial inspection found the shortcut/depth false approvals above. Stronger NB28 re-review caught them but repair/re-review exhausted the 240-second budget; NB31 re-review/repair also ended without admitted items after a provider limit. These are failed preparation checks, not successful repairs.

A fresh NB37 set under the revised policy admitted 1/3 in 149 seconds, withholding objective/order mismatches. Its accepted item applies pontocerebellar crossing to a new tracer side. A separate NB31 third-order run admitted 1/1 in 55 seconds: interrupted upper drive plus intact lower-motor connections require predicting absent voluntary contraction but retained response to direct lower-neuron stimulation. This is a narrow linked-prediction example, not a claim that the full generator now always produces optimal STEP-style patient cases. Visual item quality was not live evaluated.

The supplied original Week 14 PDF was extracted and its relevant page rendered for inspection. Corrected deterministic extraction yields 85 questions across eight titled chapters, with 84 admitted source keys; one actual routine-examination versus well-child-visit source wording difference remains held for review. The gambling item's source key D stays within its own chapter instead of inheriting B. The separate three-item PDF is a learner missed-question export with keys/explanations explicitly omitted; it must not be treated as an authoritative keyed bank. Existing account banks and historical attempts are not silently rewritten by a parser deployment; reimport of the original is needed to replace an old parse.

## Upgrade proposal reconciliation

| Area | State and next boundary |
| --- | --- |
| Shared generation, key-hidden solving, source and objective review | Implemented; live false approvals found and narrowed in this pass; broader yield/accuracy remains unverified |
| Reasoning order | First/second/third-order supported; fourth-order proposal is not implemented merely by adding a label |
| Tutor and miss repair | Existing tutor sessions, question explanation panel and learner-input miss diagnosis exist; the subsequent [Help Me Reason increment](help-me-reason.md) now adds pre-answer coaching; broader speed/transfer validation remains open |
| Quiz/exam separation | Existing practice/exam controller and scoring boundaries retained; new coaching must remain unavailable in strict exams |
| Assisted versus independent evidence | Preserve existing evidence boundaries; end-to-end hint/transfer/speed progression from the proposal still requires an explicit implementation and validation pass |
| Source originals and media | Parser, saved crop and confirmed-label corrections implemented; authenticated cross-device read-back remains separate verification |
| Readiness and speed | No new mastery, independent performance or exam-score prediction claim from these small tests |

Priority remains: repair source integrity and preserve saved exhibits; then use the implemented question-specific coach (see follow-up above); then validate unassisted transfer and timing with representative cases. Lead-in wording alone never establishes reasoning depth. School structure-identification stems may be recall; lesion-to-deficit, vascular localization and additional-finding tasks qualify only when the clues require the supplied relationships. Source text is reference data, never executable instructions, and textbook resources not actually supplied are not claimed as consulted.

## Validation

Full local suite after these changes: 2,430 passed, 37 skipped. Production build passes. Repository-wide lint has existing unrelated errors; changed-file lint is recorded separately. Local store/UI tests cover crop reuse and explicit label persistence; they do not prove authenticated cloud write/read-back. Release status must be checked against the actual deployed commit independently.
