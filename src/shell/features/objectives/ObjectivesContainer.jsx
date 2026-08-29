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
  const { objectives, blockLectures, getLecPerf, loading, error, ...actions } = useObjectivesController(
    blockId,
    userId
  );

  if (loading && !objectives.length) {
    return <div className="rounded-lg border border-border p-4 text-sm text-text-3">Syncing objectives…</div>;
  }

  return (
    <div className="desk-page desk-objectives-page mx-auto w-full max-w-6xl p-4 sm:p-5">
      <div className="desk-page-heading mb-4">
        <h2 className="text-2xl font-bold text-text-1">Objectives</h2>
        <p className="mt-1 text-sm text-text-3">
          {objectives.length} school objectives across {blockLectures.length} lectures. Start with gaps, then inspect coverage.
        </p>
      </div>
      {error && (
        <div role="alert" className="mb-3 rounded-lg border border-bad/40 bg-bg-elevated px-3 py-2 text-[13px] text-bad">
          Objectives could not sync: {error?.message || String(error)}
        </div>
      )}
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
    </div>
  );
}

export default ObjectivesContainer;
