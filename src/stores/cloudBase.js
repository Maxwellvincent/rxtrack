/**
 * Firestore-backed store primitives — the same read/write/subscribe contract
 * `base.js` exposes, with Firestore as the source of truth instead of a
 * localStorage blob that has to be merged back afterwards.
 *
 * `read` stays synchronous because every consumer is written that way. It
 * serves an in-memory cache filled by an `onSnapshot` listener, which is
 * started lazily on the first read of a key. Until the first snapshot lands the
 * cache reports itself un-hydrated, which is what makes `loading` real in
 * useStoreResource — previously it was hardcoded false.
 *
 * Offline is already handled a layer down: firebase.js initialises Firestore
 * with persistentLocalCache, so snapshots are served from IndexedDB when the
 * network is gone and writes queue until it returns. That cache is what makes
 * the hand-rolled localStorage mirror redundant.
 *
 * Docs live at users/{uid}/kv/{key} in the shape the existing sync already
 * writes — `{ data: value }` — so a converted store reads what is there today
 * with no migration.
 */
import { doc, onSnapshot, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase.js";
import { encodeDocId } from "../idCodec.js";
import { notifyStoreChanged, subscribeToStore } from "./base.js";

/** `${userId}:${logicalKey}` -> { value, hydrated, unsub, error } */
const entries = new Map();

// Test seam, mirroring functions/index.js: vi.mock of firebase/firestore does
// not reliably intercept these calls, so tests swap the backend directly.
let backend = null;
export function __setCloudBackendForTests(fake) {
  backend = fake;
  entries.clear();
}
function api() {
  return backend || { doc, onSnapshot, setDoc, serverTimestamp };
}

const cacheKey = (userId, logicalKey) => `${userId || "anon"}:${logicalKey}`;

function docRef(userId, logicalKey) {
  const { doc: docFn } = api();
  return docFn(db, "users", userId, "kv", encodeDocId(logicalKey));
}

function entryFor(userId, logicalKey) {
  const id = cacheKey(userId, logicalKey);
  let entry = entries.get(id);
  if (!entry) {
    entry = { value: undefined, hydrated: false, unsub: null, error: null };
    entries.set(id, entry);
  }
  return entry;
}

/**
 * Start listening, once per user+key. Safe to call on every read: the listener
 * is memoised and Firestore serves repeat reads from its own cache.
 */
export function ensureSubscribed(userId, logicalKey) {
  if (!userId) return;
  const entry = entryFor(userId, logicalKey);
  if (entry.unsub) return;

  const { onSnapshot: watch } = api();
  entry.unsub = watch(
    docRef(userId, logicalKey),
    (snap) => {
      entry.value = snap.exists() ? snap.data()?.data : undefined;
      entry.hydrated = true;
      entry.error = null;
      notifyStoreChanged(logicalKey, { userId, source: "firestore" });
    },
    (error) => {
      // Leave the last good value in place; a listener error must not blank the UI.
      entry.error = error;
      entry.hydrated = true;
      console.warn(`store ${logicalKey}: snapshot failed`, error?.message || error);
      notifyStoreChanged(logicalKey, { userId, source: "firestore-error" });
    }
  );
}

/** True once the first snapshot for this key has arrived. */
export function isHydrated(userId, logicalKey) {
  if (!userId) return true; // nothing to wait for when signed out
  return entryFor(userId, logicalKey).hydrated;
}

export function readError(userId, logicalKey) {
  if (!userId) return null;
  return entryFor(userId, logicalKey).error;
}

/** Synchronous read from the cache; starts the listener the first time. */
export function readCloud(userId, logicalKey, fallback) {
  if (!userId) return fallback;
  ensureSubscribed(userId, logicalKey);
  const entry = entryFor(userId, logicalKey);
  return entry.value === undefined ? fallback : entry.value;
}

/**
 * Authoritative replace, matching what a store `write` has always meant: a
 * delete has to stay deleted. The cache is updated first so the UI does not
 * wait for the round trip, and Firestore's own queue handles offline.
 */
export function writeCloud(userId, logicalKey, value) {
  if (!userId) return value;
  const entry = entryFor(userId, logicalKey);
  entry.value = value;
  entry.hydrated = true;
  notifyStoreChanged(logicalKey, { userId, source: "local-write" });

  const { setDoc: put, serverTimestamp: stamp } = api();
  Promise.resolve(
    put(docRef(userId, logicalKey), { data: value, updatedAt: stamp() }, { merge: false })
  ).catch((e) => console.warn(`store ${logicalKey}: write failed`, e?.message || e));

  return value;
}

/** Same change notification channel as the localStorage stores. */
export function subscribeToCloudStore(logicalKey, cb) {
  return subscribeToStore(logicalKey, cb);
}

/** Drop listeners — sign-out, or a test. */
export function resetCloudStores() {
  for (const entry of entries.values()) {
    try { entry.unsub?.(); } catch { /* already gone */ }
  }
  entries.clear();
}
