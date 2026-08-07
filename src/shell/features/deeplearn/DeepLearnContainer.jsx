/**
 * SP1 T6.1 — DeepLearn in the shell.
 *
 * DeepLearn is a 369KB component that was only reachable from App, and it took
 * ten props that were App closures. It is not rewritten here: the container
 * feeds it the same data from the store hooks and the ported logic modules, the
 * same way ObjectiveTracker and PatientRecognition were adopted.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
// eslint-disable-next-line no-restricted-imports -- bounded legacy adapter: DeepLearn's own port is a later chunk.
import DeepLearn from "../../../DeepLearn.jsx";
import * as objectivesStore from "../../../stores/blockObjectives.js";
import { getStoreHookUserId } from "../../hooks/currentUser.js";
import { useLectures } from "../../hooks/useLectures.js";
import { useObjectives } from "../../hooks/useObjectives.js";
import { usePerformance } from "../../hooks/usePerformance.js";
import { useQuestionBanks } from "../../hooks/useQuestionBanks.js";
import { fetchLectureContent } from "../../../supabase.js";
import { fetchTeachingMaps, withTeachingMaps } from "../../../lectureTeachingMap.js";
import { createObjectiveCommands, dedupeByText, selectBlockObjectives } from "../../logic/objectives.js";
import { detectStudyMode } from "../../logic/studyMode.js";
import { buildQuestionContext } from "../../logic/questionContext.js";

const readStylePrefs = () => {
  try {
    return JSON.parse(localStorage.getItem("rxt-style-prefs") || "{}");
  } catch {
    return {};
  }
};

/** App's key format for performance history — DeepLearn reads it 29 times. */
const makeTopicKey = (lectureId, blockId) =>
  lectureId ? `${lectureId}__${blockId}` : `block__${blockId}`;

export function DeepLearnContainer({
  blockId,
  userId = null,
  termColor,
  onBack,
  preselectLecId = null,
  deeplinkObjectiveId = null,
  initialRapidFireMode = false,
}) {
  const lectures = useLectures(blockId, userId);
  const objectivesRes = useObjectives(null, userId);
  const performance = usePerformance(userId);

  const blockObjectives = useMemo(
    () => dedupeByText(selectBlockObjectives(objectivesRes.data, blockId)),
    [objectivesRes.data, blockId]
  );

  /**
   * Teaching maps are stored in Firestore, not in the lecture rows — a block of
   * them is a few hundred KB of a ~5MB budget. DeepLearn reads lec.teachingMap
   * deep inside its own tree, so they are folded back on here, once, when
   * DeepLearn opens. Firestore serves repeats from its persistent cache.
   */
  const [teachingMaps, setTeachingMaps] = useState({});
  const lectureRows = lectures.data;
  useEffect(() => {
    let live = true;
    const uid = userId ?? getStoreHookUserId();
    if (!uid || !lectureRows?.length) return undefined;
    fetchTeachingMaps(uid, lectureRows, fetchLectureContent)
      .then((maps) => { if (live && Object.keys(maps).length) setTeachingMaps((prev) => ({ ...prev, ...maps })); })
      .catch((e) => console.warn("teaching maps: fetch failed", e?.message || e));
    return () => { live = false; };
  }, [userId, lectureRows]);

  const lecturesWithMaps = useMemo(
    () => withTeachingMaps(lectureRows, teachingMaps),
    [lectureRows, teachingMaps]
  );

  // DeepLearn asks for other blocks' objectives too (it can jump blocks).
  const getBlockObjectives = useCallback(
    (bid) => dedupeByText(selectBlockObjectives(objectivesRes.data, bid)),
    [objectivesRes.data]
  );

  const mutateObjectives = objectivesRes.mutate;
  const onAppendObjectiveNote = useCallback(
    (bid, objectiveId, line) => {
      if (!bid || !objectiveId || line == null) return;
      const commands = createObjectiveCommands({
        read: () => objectivesStore.read(userId ?? getStoreHookUserId()),
        write: (next) => mutateObjectives(next),
        notify: () => {
          try { window.dispatchEvent(new CustomEvent("rxt-objectives-updated")); } catch { /* non-DOM */ }
        },
      });
      const current = getBlockObjectives(bid).find((o) => o.id === objectiveId);
      commands.updateObjective(bid, objectiveId, {
        personalNotes: (current?.personalNotes || "") + line,
      });
    },
    [userId, mutateObjectives, getBlockObjectives]
  );

  const questionBanksByFile = useQuestionBanks(userId).data;

  const questionContext = useCallback(
    (bid, lectureId, banksArg, _mode = "quiz", options = {}) =>
      buildQuestionContext({
        lectureId,
        lectures: lecturesWithMaps,
        objectives: getBlockObjectives(bid),
        questionBanks: banksArg || questionBanksByFile,
        selectedLecIds: options.selectedLecIds ?? null,
        stylePrefs: readStylePrefs(),
      }),
    [lecturesWithMaps, getBlockObjectives, questionBanksByFile]
  );

  return (
    <DeepLearn
      blockId={blockId}
      userId={userId}
      lecs={lecturesWithMaps}
      blockObjectives={blockObjectives}
      getBlockObjectives={getBlockObjectives}
      onAppendObjectiveNote={onAppendObjectiveNote}
      questionBanksByFile={questionBanksByFile}
      buildQuestionContext={questionContext}
      detectStudyMode={detectStudyMode}
      makeTopicKey={makeTopicKey}
      performanceHistory={performance.data}
      termColor={termColor}
      preselectLecId={preselectLecId}
      deeplinkObjectiveId={deeplinkObjectiveId}
      initialRapidFireMode={initialRapidFireMode}
      onBack={onBack}
      onRelaunch={onBack}
    />
  );
}

export default DeepLearnContainer;
