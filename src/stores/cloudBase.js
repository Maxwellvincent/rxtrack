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
import { notifyStoreChanged, subscribeToStore, writeJson } from "./base.js";

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

/**
 * Where each key actually lives in Firestore.
 *
 * Not everything is a `kv` document. Five stores were promoted to their own
 * `state/{name}` documents by the original sync, with names that do not match
 * the localStorage key — rxt-weak-concepts is state/weak_concepts, rxt-tracker-v2
 * is state/tracker. Reading them from kv/{key} finds nothing, which is exactly
 * what happened on the first live run of this: terms came back empty.
 *
 * Two keys are not single documents at all and cannot be served from here:
 * rxt-lec-meta is a document per lecture and rxt-block-objectives is a document
 * per block. They need a collection-backed store, not this one.
 */
const STATE_DOCS = {
  "rxt-terms": "terms",
  "rxt-performance": "performance",
  "rxt-completion": "completion",
  "rxt-weak-concepts": "weak_concepts",
  "rxt-tracker-v2": "tracker",
};

const COLLECTION_BACKED = new Set(["rxt-lec-meta", "rxt-block-objectives"]);

export function docPathFor(userId, logicalKey) {
  if (COLLECTION_BACKED.has(logicalKey)) {
    throw new Error(`${logicalKey} is a collection, not a single document — it needs a collection-backed store`);
  }
  const stateName = STATE_DOCS[logicalKey];
  return stateName
    ? ["users", userId, "state", stateName]
    : ["users", userId, "kv", encodeDocId(logicalKey)];
}

function docRef(userId, logicalKey) {
  const { doc: docFn } = api();
  return docFn(db, ...docPathFor(userId, logicalKey));
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
 * Keys App.jsx still reads straight out of localStorage get a mirrored copy.
 *
 * App reads rxt-lec-meta 57 times, rxt-completion 48, rxt-performance 41, all
 * synchronously and none through a store module. Making those keys cloud-only
 * would leave every App surface reading a copy that stops being updated. So
 * while App still owns those surfaces, a converted store writes both places:
 * Firestore is the source of truth, localStorage is a read-only shadow for App.
 *
 * Each entry here is removed when T6.1 deletes the App surface that reads it —
 * at which point the key becomes cloud-only and stops costing storage.
 */
const MIRRORED_TO_LOCAL = new Set([
  "rxt-terms",
  "rxt-performance",
  "rxt-completion",
  "rxt-weak-concepts",
  "rxt-lec-meta",
  "rxt-block-objectives",
  "rxt-tracker-v2",
]);

export function isMirrored(logicalKey) {
  return MIRRORED_TO_LOCAL.has(logicalKey);
}

function mirrorLocally(userId, logicalKey, value) {
  if (!isMirrored(logicalKey) || value === undefined) return;
  try {
    // silent: the caller announces this change itself, and notifying here too
    // would run every subscriber twice per write.
    writeJson(userId, logicalKey, value, { silent: true });
  } catch (e) {
    // A full quota must not break the cloud write that already succeeded.
    console.warn(`store ${logicalKey}: local mirror failed`, e?.message || e);
  }
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
      // A change made on another device has to reach App's copy too.
      mirrorLocally(userId, logicalKey, entry.value);
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
  mirrorLocally(userId, logicalKey, value);
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
