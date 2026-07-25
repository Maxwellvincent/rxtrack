import { useCallback } from "react";
import * as store from "../../stores/weakConcepts.js";
import { useStoreResource } from "./useStoreResource.js";

export function useWeakConcepts(blockId, userId) {
  const select = useCallback(
    (concepts) => blockId ? concepts?.[blockId] ?? [] : concepts || {},
    [blockId]
  );
  const prepareWrite = useCallback((next) => blockId ? { [blockId]: next } : next, [blockId]);
  return useStoreResource(store, userId, select, prepareWrite);
}
