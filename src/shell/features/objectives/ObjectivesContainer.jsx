/**
 * SP1 T1.2/T1.3 — shell entry point for objectives.
 *
 * The presentational tree (`ObjectiveTracker`, moved into this folder in T1.3)
 * gets everything it used to get from App.jsx from `useObjectivesController`
 * instead — store hooks + the pure commands in shell/logic.
 */
import { useState } from "react";
import ObjectiveTracker from "./ObjectiveTracker.jsx";
import { useObjectivesController } from "./useObjectivesController.js";

export function ObjectivesContainer({
  blockId,
  userId,
  termColor,
  T,
  headerActions = null,
  focusUnlinkedTabKey = 0,
  // Still App-owned surfaces (AI re-extract, quiz launch) — passed through when
  // a caller has them, absent in the new shell until T1.3 wires the real path.
  onStartObjectiveQuiz = null,
  onStudyLecture = null,
  quizLoadingId = null,
  quizErrorId = null,
  quizFlashLectureId = null,
  onReExtractObjectives = null,
  reExtractingLectureId = null,
  smartTruncateTitle = null,
}) {
  const [editingLecId, setEditingLecId] = useState(null);
  const [editingTitle, setEditingTitle] = useState("");
  const { objectives, blockLectures, getLecPerf, ...actions } = useObjectivesController(
    blockId,
    userId
  );

  return (
    <ObjectiveTracker
      blockId={blockId}
      blockLectures={blockLectures}
      objectives={objectives}
      coverageObjectives={objectives}
      getLecPerf={getLecPerf}
      termColor={termColor}
      T={T}
      headerActions={headerActions}
      focusUnlinkedTabKey={focusUnlinkedTabKey}
      editingLecId={editingLecId}
      setEditingLecId={setEditingLecId}
      editingTitle={editingTitle}
      setEditingTitle={setEditingTitle}
      smartTruncateTitle={smartTruncateTitle}
      onStartObjectiveQuiz={onStartObjectiveQuiz}
      onStudyLecture={onStudyLecture}
      quizLoadingId={quizLoadingId}
      quizErrorId={quizErrorId}
      quizFlashLectureId={quizFlashLectureId}
      onReExtractObjectives={onReExtractObjectives}
      reExtractingLectureId={reExtractingLectureId}
      {...actions}
    />
  );
}

export default ObjectivesContainer;
