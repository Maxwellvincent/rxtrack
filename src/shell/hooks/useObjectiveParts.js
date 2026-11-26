import { useMemo } from "react";
import { useStoreResource } from "./useStoreResource.js";
import * as objectivePartsStore from "../../stores/objectiveParts.js";
import { combineInventories, withPartTargets } from "../../engine/objectiveParts.js";

/**
 * Stored parts inventories for several lectures, combined into one. Read-only:
 * inventories are built when a quiz or exam is prepared, never by a dashboard.
 */
export function useLecturePartsInventory(userId, lectureIds = []) {
  const key = [...new Set((lectureIds || []).filter(Boolean).map(String))].sort().join("|");
  const adapter = useMemo(() => {
    const ids = key ? key.split("|") : [];
    return {
      read: (uid) => combineInventories(ids.map((id) => objectivePartsStore.read(uid, id))),
      isHydrated: (uid) => ids.every((id) => objectivePartsStore.isHydrated(uid, id)),
      readError: () => null,
      subscribe: (callback) => {
        const offs = ids.map((id) => objectivePartsStore.subscribe(id, callback));
        return () => offs.forEach((off) => off?.());
      },
    };
  }, [key]);
  return useStoreResource(adapter, userId);
}

/** Objectives with `_parts` attached from their lectures' stored inventories. */
export function useObjectivesWithParts(userId, objectives = [], journal = []) {
  const lectureIds = useMemo(() => objectives.map((objective) => objective?.linkedLecId).filter(Boolean), [objectives]);
  const parts = useLecturePartsInventory(userId, lectureIds);
  return useMemo(() => withPartTargets(objectives, parts.data, journal || []), [objectives, parts.data, journal]);
}
