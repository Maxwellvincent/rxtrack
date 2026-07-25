import { useCallback, useMemo, useSyncExternalStore } from "react";
import { getStoreHookUserId, subscribeStoreHookUser } from "./currentUser.js";

function stableSnapshot(store, userId) {
  try { return JSON.stringify(store.read(userId)); }
  catch { return ""; }
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
    try {
      const all = snapshot ? JSON.parse(snapshot) : store.read(userId);
      return { data: select(all), loading: false, error: null };
    } catch (error) {
      return { data: select(store.read(userId)), loading: false, error };
    }
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
