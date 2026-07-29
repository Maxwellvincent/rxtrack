import { useCallback, useMemo, useSyncExternalStore } from "react";
import { getStoreHookUserId, subscribeStoreHookUser } from "./currentUser.js";

/**
 * Key-order-independent stringify.
 *
 * useSyncExternalStore treats a changed string as changed data. Firestore does
 * not preserve map key order between snapshots — the same exam-dates document
 * came back with its six keys in a different order — so a plain JSON.stringify
 * reports a change on every snapshot and re-renders every consumer for nothing.
 */
function stableStringify(value) {
  if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
  if (value && typeof value === "object") {
    return "{" + Object.keys(value).sort().map((k) => JSON.stringify(k) + ":" + stableStringify(value[k])).join(",") + "}";
  }
  return JSON.stringify(value) ?? "null";
}

function stableSnapshot(store, userId) {
  try { return stableStringify(store.read(userId)); }
  catch { return ""; }
}

/**
 * `loading` and `error` are real for a cloud-backed store and inert for a
 * localStorage one, which answers synchronously and is therefore never loading.
 * A store opts in by exporting `isHydrated` / `readError`; the shape consumers
 * receive is identical either way, which is what lets stores convert one at a
 * time without touching a single surface.
 */
function statusOf(store, userId) {
  const loading = typeof store.isHydrated === "function" ? !store.isHydrated(userId) : false;
  const error = typeof store.readError === "function" ? store.readError(userId) : null;
  return { loading, error };
}

export function useStoreResource(store, userIdArg, select = (data) => data, prepareWrite = (value) => value) {
  const userId = userIdArg ?? getStoreHookUserId();
  const subscribe = useCallback((cb) => {
    const unsubStore = store.subscribe(cb);
    const unsubUser = userIdArg == null ? subscribeStoreHookUser(cb) : () => {};
    return () => { unsubStore(); unsubUser(); };
  }, [store, userIdArg]);

  const snapshot = useSyncExternalStore(
    subscribe,
    () => stableSnapshot(store, userId),
    () => stableSnapshot(store, userId)
  );

  const state = useMemo(() => {
    const { loading, error } = statusOf(store, userId);
    try {
      // Read the store, never the snapshot: the snapshot is key-sorted for
      // comparison, and parsing it back would hand consumers a reordered object.
      // That reordering is not cosmetic — an objectives entry whose `extracted`
      // key sorts before `imported` changes the order objectives are listed in.
      // `snapshot` stays in the dependency list purely as the change signal.
      return { data: select(store.read(userId)), loading, error };
    } catch (readError_) {
      return { data: select(undefined), loading, error: error || readError_ };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot, store, userId, select]);

  const mutate = useCallback((value) => {
    try {
      return store.write(userId, prepareWrite(value, store.read(userId)));
    } catch (error) {
      return Promise.reject(error);
    }
  }, [store, userId, prepareWrite]);

  return { ...state, mutate };
}
