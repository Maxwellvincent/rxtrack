/**
 * Block objectives, Firestore-first — a document per block.
 *
 * This is the store cloudBase.js explicitly refuses: objectives are not one
 * document, they are users/{uid}/objectives/{blockId}, which is why the old sync
 * had a per-block loop and its own authoritative writer.
 *
 * One collection listener keeps every block in memory, so `read()` stays
 * synchronous and complete for the shell. localStorage gets only the HOT blocks
 * — the ones recently worked in — because App.jsx still reads that key directly
 * in around forty places and cannot be made async tonight.
 *
 * The consequence, stated plainly: in the old shell, a block that has been
 * evicted shows no objectives until it is opened in the new shell again. The new
 * shell is unaffected — it reads this store, which has them all. Term 1 is
 * finished and accounts for 1.1MB of a ~5MB budget, which is what makes the
 * trade worth making.
 */
import { collection, doc, onSnapshot, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase.js";
import { encodeDocId, decodeDocId } from "../idCodec.js";
import { notifyStoreChanged, subscribeToStore, writeJson, readJson } from "./base.js";
import { mergeObjectivesMap } from "./merge.js";

export const key = "rxt-block-objectives";

/**
 * How many blocks keep a localStorage copy for App.
 *
 * One: the block on screen. A single big block is already over a megabyte —
 * Nervous System & Behavior is 75 lectures — so mirroring three of them costs
 * more than the whole budget has spare. App keeps working for the block being
 * worked in, which is the only one its surfaces are showing anyway.
 */
export const HOT_BLOCK_LIMIT = 1;

const state = {
  userId: null,
  blocks: new Map(), // blockId -> entry
  hydrated: false,
  error: null,
  unsub: null,
  hot: [], // blockIds, most recently touched first
};

let backend = null;
export function __setObjectivesBackendForTests(fake) {
  backend = fake;
  resetObjectivesStore();
}
function api() {
  return backend || { collection, doc, onSnapshot, setDoc, serverTimestamp };
}

export function resetObjectivesStore() {
  try { state.unsub?.(); } catch { /* already gone */ }
  state.userId = null;
  state.blocks = new Map();
  state.hydrated = false;
  state.error = null;
  state.unsub = null;
  state.hot = [];
}

/** Mark a block as being worked in, so it keeps a local copy for App. */
export function touchBlock(blockId) {
  if (!blockId) return;
  state.hot = [blockId, ...state.hot.filter((b) => b !== blockId)].slice(0, HOT_BLOCK_LIMIT);
}

export function hotBlocks() {
  return [...state.hot];
}

/** What localStorage should hold: the hot blocks only. */
function mirrorHot() {
  if (!state.userId) return;
  const out = {};
  for (const blockId of state.hot) {
    if (state.blocks.has(blockId)) out[blockId] = state.blocks.get(blockId);
  }
  try {
    writeJson(state.userId, key, out, { silent: true });
  } catch (e) {
    console.warn("block objectives: local mirror failed", e?.message || e);
  }
}

function ensureSubscribed(userId) {
  if (!userId) return;
  if (state.unsub && state.userId === userId) return;
  if (state.userId !== userId) resetObjectivesStore();
  state.userId = userId;

  const { collection: coll, onSnapshot: watch } = api();
  state.unsub = watch(
    coll(db, "users", userId, "objectives"),
    (snap) => {
      const next = new Map();
      snap.forEach((d) => next.set(decodeDocId(d.id), d.data()?.data));
      state.blocks = next;
      state.hydrated = true;
      state.error = null;
      mirrorHot();
      notifyStoreChanged(key, { userId, source: "firestore" });
    },
    (error) => {
      state.error = error;
      state.hydrated = true;
      console.warn("block objectives: snapshot failed", error?.message || error);
      notifyStoreChanged(key, { userId, source: "firestore-error" });
    }
  );
}

/**
 * The whole map, as every consumer expects.
 *
 * Before the first snapshot lands it falls back to whatever localStorage holds,
 * so a reload shows the last known objectives rather than an empty block.
 */
export function read(userId) {
  if (!userId) return readJson(userId, key, {});
  ensureSubscribed(userId);
  if (!state.hydrated) return readJson(userId, key, {});
  return Object.fromEntries(state.blocks);
}

/** Authoritative per-block write: only the blocks that actually changed. */
export function write(userId, value) {
  if (!userId) return value;
  ensureSubscribed(userId);
  const next = value && typeof value === "object" ? value : {};
  const { doc: docFn, setDoc: put, serverTimestamp: stamp } = api();

  for (const [blockId, entry] of Object.entries(next)) {
    const before = state.blocks.get(blockId);
    if (before !== undefined && JSON.stringify(before) === JSON.stringify(entry)) continue;
    state.blocks.set(blockId, entry);
    touchBlock(blockId);
    Promise.resolve(
      put(docFn(db, "users", userId, "objectives", encodeDocId(blockId)), { data: entry, updatedAt: stamp() }, { merge: false })
    ).catch((e) => console.warn(`block objectives: write failed for ${blockId}`, e?.message || e));
  }

  state.hydrated = true;
  mirrorHot();
  notifyStoreChanged(key, { userId, source: "local-write" });
  return next;
}

/**
 * The legacy sync path still calls this, and it must keep the per-block deep
 * merge: a shallow block-level spread replaces the whole entry, so an objective
 * missing from the incoming copy is dropped. That is the exact regression
 * replaceSemantics.test.js exists to catch.
 */
export function merge(userId, incoming) {
  return write(userId, mergeObjectivesMap(read(userId) || {}, incoming || {}));
}

export function subscribe(cb) {
  return subscribeToStore(key, cb);
}

export function isHydrated(userId) {
  if (!userId) return true;
  return state.hydrated;
}

export function readError(userId) {
  return userId ? state.error : null;
}
