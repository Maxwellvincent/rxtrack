/**
 * SP1 T6.1 — DeepLearn in the shell.
 *
 * DeepLearn is a 369KB component that was only reachable from App, and it took
 * ten props that were App closures. It is not rewritten here: the container
 * feeds it the same data from the store hooks and the ported logic modules, the
 * same way ObjectiveTracker and PatientRecognition were adopted.
 */
import { useCallback, useMemo } from "react";
// eslint-disable-next-line no-restricted-imports -- bounded legacy adapter: DeepLearn's own port is a later chunk.
import DeepLearn from "../../../DeepLearn.jsx";
import * as objectivesStore from "../../../stores/blockObjectives.js";
import { getStoreHookUserId } from "../../hooks/currentUser.js";
import { useLectures } from "../../hooks/useLectures.js";
import { useObjectives } from "../../hooks/useObjectives.js";
import { usePerformance } from "../../hooks/usePerformance.js";
import { createObjectiveCommands, dedupeByText, selectBlockObjectives } from "../../logic/objectives.js";
import { detectStudyMode } from "../../logic/studyMode.js";
import { buildQuestionContext } from "../../logic/questionContext.js";

const readQuestionBanks = () => {
  try {
    return JSON.parse(localStorage.getItem("rxt-question-banks") || "{}");
  } catch {
    return {};
  }
};

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

  // Read once per mount: the banks only change on upload, which happens in App.
  const questionBanksByFile = useMemo(() => readQuestionBanks(), []);

  const questionContext = useCallback(
    (bid, lectureId, banksArg, _mode = "quiz", options = {}) =>
      buildQuestionContext({
        lectureId,
        lectures: lectures.data,
        objectives: getBlockObjectives(bid),
        questionBanks: banksArg || questionBanksByFile,
        selectedLecIds: options.selectedLecIds ?? null,
        stylePrefs: readStylePrefs(),
      }),
    [lectures.data, getBlockObjectives, questionBanksByFile]
  );

  return (
    <DeepLearn
      blockId={blockId}
      lecs={lectures.data}
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
