# Lecture workspace and objective-review repair

November 2, 2026.

The lecture page now uses four task-based destinations instead of displaying its separate workflows in one vertical stack:

- Practice (default): current preparation, unfinished quizzes, repair context and quiz controls, with a compact answer/accuracy summary.
- Learn: guided tutor, mental models, study guide and supporting lecture facts.
- Progress: PowerPoint reviews, notes/model completion, retrieval enrollment, detailed objective readiness and recent practice follow-up.
- Sources & tools: original files, figure attachment, re-extraction and deletion.

Switching destinations preserves mounted content and in-progress state. Active quizzes still use their dedicated view; an atom-review jump selects Learn before scrolling. Errors remain visible across destinations. This reorganizes existing data without a storage migration, deleting study evidence or declaring all older tools obsolete.

## Generation defect

Strict objective validation already required `bestSourceObjectiveCode` and `whyAssignedOverNeighbor` when the source contained neighboring objectives. Review prompts did not consistently supply the ownership instructions, and their JSON examples omitted both fields. This could reject an otherwise approved item as unverified ownership.

Both compact and full review prompts now include the neighboring source inventory and complete ownership schema. A compact approved review with otherwise verifiable reasoning gets at most one correction attempt for missing ownership evidence. Genuine negative alignment verdicts do not take that metadata-correction path. Unverified source reasoning does not receive extra attempts merely because ownership is also absent. Rejection issue lists retain other reported defects so a repair can address ambiguity as well as alignment. No ambiguity, medical, depth or objective gate was relaxed.

Regression tests exercise both prompt formats, bounded missing-metadata recovery, genuine mismatch rejection and workspace navigation. Full suite: 2,251 passed, 37 skipped. Build and changed-file lint pass with pre-existing component warnings. Fresh NB35 model output and signed-in visual/persistence verification remain untested; no private lecture material was sent to a model for this change.
