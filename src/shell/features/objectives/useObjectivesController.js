/**
 * SP1 T1.2 — the objectives read model + action adapters.
 *
 * Everything ObjectiveTracker used to receive from App.jsx is produced here
 * instead: the objective list comes off the store hooks, and every callback is
 * an adapter over the pure commands in `src/shell/logic/objectives.js`.
 *
 * The hook is deliberately separate from the container component so it can be
 * tested without rendering the 85KB legacy tree.
 */
import { useCallback, useMemo } from "react";
import * as objectivesStore from "../../../stores/blockObjectives.js";
import { getStoreHookUserId } from "../../hooks/currentUser.js";
import { useLectures } from "../../hooks/useLectures.js";
import { useObjectives } from "../../hooks/useObjectives.js";
import { usePerformance } from "../../hooks/usePerformance.js";
import {
  createObjectiveCommands,
  dedupeByText,
  selectBlockObjectives,
} from "../../logic/objectives.js";

/** App fired these so other mounted surfaces re-read storage; keep the contract. */
function emit(name) {
  try { window.dispatchEvent(new CustomEvent(name)); } catch { /* non-DOM env */ }
}

export function useObjectivesController(blockId, userId) {
  // The whole map: the commands own the per-block slot (legacy `msk`,
  // imported/extracted buckets), so selecting per block here would fight them.
  const objectivesRes = useObjectives(null, userId);
  const lecturesRes = useLectures(blockId, userId);
  const performanceRes = usePerformance(userId);

  const blockLectures = lecturesRes.data;

  const objectives = useMemo(
    () => dedupeByText(selectBlockObjectives(objectivesRes.data, blockId)),
    [objectivesRes.data, blockId]
  );

  const mutateObjectives = objectivesRes.mutate;
  const commands = useMemo(
    () =>
      createObjectiveCommands({
        read: () => objectivesStore.read(userId ?? getStoreHookUserId()),
        write: (next) => mutateObjectives(next),
        notify: () => emit("rxt-objectives-updated"),
      }),
    [userId, mutateObjectives]
  );

  // Exact-key first, then any older key for the same lecture id. Never falls
  // back to lecture number — a re-upload must start with a clean history.
  const performance = performanceRes.data;
  const getLecPerf = useCallback(
    (lec, bid) => {
      const history = performance || {};
      const exactKey = lec?.id ? `${lec.id}__${bid}` : `block__${bid}`;
      if (history[exactKey]) return history[exactKey];
      if (!lec?.id) return null;
      const byId = Object.keys(history).find((k) => k.startsWith(lec.id + "__"));
      return byId ? history[byId] : null;
    },
    [performance]
  );

  const mutateLectures = lecturesRes.mutate;
  const renameLecture = useCallback(
    (lecId, newTitle) => {
      const title = (newTitle || "").trim();
      if (!lecId || !title) return;
      const next = (blockLectures || []).map((lec) =>
        lec?.id === lecId ? { ...lec, lectureTitle: title } : lec
      );
      mutateLectures(next);
      emit("rxt-lec-updated");
    },
    [blockLectures, mutateLectures]
  );

  const actions = useMemo(
    () => ({
      onUpdateObjectiveStatus: (objId, status) => commands.setStatus(blockId, objId, status),
      onSelfRate: (objId, status) => commands.selfRate(blockId, objId, status),
      onAssignObjectiveToLecture: (objId, lecId) => commands.assignToLecture(blockId, objId, lecId),
      onAssignAllVisibleObjectives: (lecId, objIds) =>
        commands.assignManyToLecture(blockId, objIds, lecId),
      onAssignMultipleToLecture: (objIds, lecId) =>
        commands.assignManyToLecture(blockId, objIds, lecId),
      onRemoveObjectiveLink: (objId) => commands.removeLectureLink(blockId, objId),
      onDeleteSingleObjective: (objId) => commands.deleteObjectives(blockId, [objId]),
      onDeleteMultipleObjectives: (objIds) => commands.deleteObjectives(blockId, objIds),
      onDeleteUnlinkedObjectives: () => commands.deleteUnlinked(blockId, blockLectures),
      onRenameLecture: renameLecture,
    }),
    [commands, blockId, blockLectures, renameLecture]
  );

  return { objectives, blockLectures, getLecPerf, commands, ...actions };
}
