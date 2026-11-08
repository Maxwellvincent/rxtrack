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

// Share one comparison and one upstream subscription per store/account.
// Large immutable snapshots are compared only after a store notification.
const snapshots = new WeakMap();
const subscriptions = new WeakMap();
function accountMap(cache,store){if(!cache.has(store))cache.set(store,new Map());return cache.get(store);}
function resourceSnapshot(store,userId){
 const map=accountMap(snapshots,store),previous=map.get(userId);
 let value,readError;
 try{value=store.read(userId);}catch(error){readError=error;}
 const status=statusOf(store,userId),error=status.error||readError||null;
 if(previous&&!previous.dirty&&previous.value===value&&previous.result.loading===status.loading&&previous.errorMessage===(error?.message||''))return previous.result;
 const signature=stableStringify(value);
 if(previous&&previous.signature===signature&&previous.result.loading===status.loading&&previous.errorMessage===(error?.message||'')){
  previous.value=value;previous.dirty=false;return previous.result;
 }
 const result={data:value,loading:status.loading,error};
 map.set(userId,{value,signature,errorMessage:error?.message||'',result,dirty:false});return result;
}
function subscribeResource(store,userId,cb){
 const map=accountMap(subscriptions,store);let entry=map.get(userId);
 if(!entry){entry={listeners:new Set(),off:null};map.set(userId,entry);entry.off=store.subscribe(()=>{
  const snapshot=accountMap(snapshots,store).get(userId);if(snapshot)snapshot.dirty=true;
  for(const listener of entry.listeners)listener();
 });}
 entry.listeners.add(cb);
 return()=>{entry.listeners.delete(cb);if(!entry.listeners.size){entry.off?.();map.delete(userId);}};
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

const identity = value => value;

export function useStoreResource(store, userIdArg, select = identity, prepareWrite = identity) {
  const userId = userIdArg ?? getStoreHookUserId();
  const subscribe = useCallback((cb) => {
    const unsubStore = subscribeResource(store,userId,cb);
    const unsubUser = userIdArg == null ? subscribeStoreHookUser(cb) : () => {};
    return () => { unsubStore(); unsubUser(); };
  }, [store, userId, userIdArg]);

  const snapshot = useSyncExternalStore(
    subscribe,
    () => resourceSnapshot(store, userId),
    () => resourceSnapshot(store, userId)
  );

  const state = useMemo(() => {
    const {data,loading,error}=snapshot;
    try{return {data:select(data),loading,error};}
    catch(readError_){return {data:select(undefined),loading,error:error||readError_};}
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
