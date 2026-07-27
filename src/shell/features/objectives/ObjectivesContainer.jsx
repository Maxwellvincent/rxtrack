/**
 * SP1 T1.2 — shell entry point for objectives.
 *
 * Bounded legacy adapter: the presentational tree is still `ObjectiveTracker`,
 * but every prop it used to get from App.jsx now comes from
 * `useObjectivesController` (store hooks + pure commands). T1.3 moves the tree
 * itself under this folder; until then this file is the only place in
 * `src/shell/features` allowed to import it.
 */
import { useState } from "react";
// eslint-disable-next-line no-restricted-imports -- bounded legacy adapter (SP1 T1.2); the tree moves here in T1.3.
import ObjectiveTracker from "../../../ObjectiveTracker.jsx";
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
