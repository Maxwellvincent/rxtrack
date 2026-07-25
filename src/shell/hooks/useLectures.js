import { useCallback } from "react";
import * as store from "../../stores/lectures.js";
import { useStoreResource } from "./useStoreResource.js";

export function useLectures(blockId, userId) {
  const select = useCallback(
    (lectures) => blockId ? (lectures || []).filter((lecture) => lecture?.blockId === blockId) : (lectures || []),
    [blockId]
  );
  const prepareWrite = useCallback((next, current) => {
    if (!blockId) return next;
    const incoming = Array.isArray(next) ? next : [];
    return [...(current || []).filter((lecture) => lecture?.blockId !== blockId), ...incoming];
  }, [blockId]);
  return useStoreResource(store, userId, select, prepareWrite);
}
