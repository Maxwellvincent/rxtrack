import { useCallback } from "react";
import * as store from "../../stores/blockObjectives.js";
import { useStoreResource } from "./useStoreResource.js";

export function useObjectives(blockId, userId) {
  const select = useCallback(
    (objectives) => blockId ? objectives?.[blockId] ?? null : objectives || {},
    [blockId]
  );
  const prepareWrite = useCallback((next) => blockId ? { [blockId]: next } : next, [blockId]);
  return useStoreResource(store, userId, select, prepareWrite);
}
