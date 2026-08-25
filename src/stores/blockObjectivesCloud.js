/**
 * Block objectives, Firestore-first — a document per block.
 *
 * This is the store cloudBase.js explicitly refuses: objectives are not one
 * document, they are users/{uid}/objectives/{blockId}, which is why the old sync
 * had a per-block loop and its own authoritative writer.
 *
 * One collection listener keeps every block in memory, so `read()` stays
 * synchronous and complete for every consumer that goes through this store.
 * localStorage gets only the HOT blocks — the ones recently worked in — because
 * one direct reader is left: shell/data.js `blockCoverage`, which the sidebar
 * calls per block to draw its coverage percentage.
 *
 * The consequence, stated plainly: the sidebar shows no coverage figure for a
 * block that has been evicted until it is opened again. Everything that reads
 * this store has all the blocks regardless. Term 1 is finished and accounts for
 * 1.1MB of a ~5MB budget, which is what makes the trade worth making.
 */
import { collection, doc, onSnapshot, setDoc, deleteDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase.js";
import { encodeDocId, decodeDocId } from "../idCodec.js";
import { notifyStoreChanged, subscribeToStore, writeJson, readJson } from "./base.js";
import { mergeObjectivesMap } from "./merge.js";
import { stripUndefined } from "./cloudBase.js";

// Firestore hard limit is 1 MB per document. Stay safely under it.
const SHARD_LIMIT_BYTES = 800_000;
const SHARD_SUFFIX = "__s";

// Inlined from shell/logic/objectives.js to avoid cross-layer imports.
function flattenEntry(entry) {
  if (entry == null) return [];
  if (Array.isArray(entry)) return [...entry];
  const values = Object.values(entry);
  if (values.length === 0) return [];
  if (Array.isArray(values[0])) return values.filter(Array.isArray).flat();
  if (values[0] && typeof values[0] === "object" && values[0].id != null)
    return values.filter((v) => v && typeof v === "object" && v.id != null);
  const out = [];
  values.forEach((val) => { if (Array.isArray(val)) out.push(...val); });
  return out;
}

function isShardDocId(decoded) {
  return new RegExp(`${SHARD_SUFFIX}\\d+$`).test(decoded);
}
function baseBlockId(shardDecoded) {
  return shardDecoded.replace(new RegExp(`${SHARD_SUFFIX}\\d+$`), "");
}
function shardIndex(shardDecoded) {
  return parseInt(shardDecoded.match(new RegExp(`${SHARD_SUFFIX}(\\d+)$`))[1], 10);
}

/**
 * Split a flat objectives array into chunks, each serialising under SHARD_LIMIT_BYTES.
 * Returns an array of arrays (length >= 1).
 */
function splitIntoShards(flat) {
  const shards = [];
  let current = [];
  let currentBytes = 2; // "[]"
  for (const obj of flat) {
    const objBytes = JSON.stringify(obj).length + 1; // +1 for comma
    if (current.length > 0 && currentBytes + objBytes > SHARD_LIMIT_BYTES) {
      shards.push(current);
      current = [obj];
      currentBytes = 2 + objBytes;
    } else {
      current.push(obj);
      currentBytes += objBytes;
    }
  }
  if (current.length > 0) shards.push(current);
  return shards.length > 0 ? shards : [[]];
}

export const key = "rxt-block-objectives";

/**
 * How many blocks keep a localStorage copy for the remaining direct reader.
 *
 * One: the block on screen. A single big block is already over a megabyte —
 * Nervous System & Behavior is 75 lectures — so mirroring three of them costs
 * more than the whole budget has spare.
 */
export const HOT_BLOCK_LIMIT = 1;

const state = {
  userId: null,
  blocks: new Map(),      // blockId -> entry
  shardCounts: new Map(), // blockId -> last written shardCount
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
  return backend || { collection, doc, onSnapshot, setDoc, deleteDoc, serverTimestamp };
}

export function resetObjectivesStore() {
  try { state.unsub?.(); } catch { /* already gone */ }
  state.userId = null;
  state.blocks = new Map();
  state.shardCounts = new Map();
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

function reportWriteError(userId, blockId, error) {
  state.error = error;
  console.warn(`block objectives: write failed for ${blockId}`, error?.message || error);
  notifyStoreChanged(key, { userId, blockId, source: "firestore-write-error" });
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
      // Collect base docs and shard docs separately, then merge shards in.
      const baseDocs = new Map(); // blockId -> full doc data
      const shardBuckets = new Map(); // blockId -> sparse array indexed by shard number
      snap.forEach((d) => {
        const decoded = decodeDocId(d.id);
        if (isShardDocId(decoded)) {
          const base = baseBlockId(decoded);
          const idx = shardIndex(decoded);
          if (!shardBuckets.has(base)) shardBuckets.set(base, []);
          shardBuckets.get(base)[idx] = d.data()?.data;
        } else {
          baseDocs.set(decoded, d.data());
        }
      });

      const next = new Map();
      const nextShardCounts = new Map();
      for (const [blockId, docData] of baseDocs) {
        const shardCount = docData?.shardCount ?? 1;
        nextShardCounts.set(blockId, shardCount);
        if (shardCount > 1) {
          // Reassemble: base doc holds shard 0; subsequent shards are separate docs.
          const bucket = shardBuckets.get(blockId) || [];
          const allObjs = [...flattenEntry(docData?.data)];
          for (let i = 1; i < shardCount; i++) {
            allObjs.push(...flattenEntry(bucket[i] ?? []));
          }
          next.set(blockId, allObjs);
        } else {
          next.set(blockId, docData?.data);
        }
      }
      state.blocks = next;
      state.shardCounts = nextShardCounts;
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
  const { doc: docFn, setDoc: put, deleteDoc: del, serverTimestamp: stamp } = api();

  for (const [blockId, entry] of Object.entries(next)) {
    const before = state.blocks.get(blockId);
    if (before !== undefined && JSON.stringify(before) === JSON.stringify(entry)) continue;
    state.blocks.set(blockId, entry);
    touchBlock(blockId);

    const clean = stripUndefined(entry);
    const serialized = JSON.stringify(clean);
    const prevShardCount = state.shardCounts.get(blockId) ?? 1;

    if (serialized.length > SHARD_LIMIT_BYTES) {
      // Split flat objectives across shard docs; base doc holds shard 0.
      const flat = flattenEntry(entry);
      const shards = splitIntoShards(flat);
      state.shardCounts.set(blockId, shards.length);
      // Delete any shard docs from a previous write that used more shards.
      const staleDeletes = [];
      for (let i = shards.length; i < prevShardCount; i++) {
        staleDeletes.push(del(docFn(db, "users", userId, "objectives", encodeDocId(`${blockId}${SHARD_SUFFIX}${i}`))));
      }
      const basePayload = { data: stripUndefined(shards[0]), shardCount: shards.length, updatedAt: stamp() };
      Promise.all([
        put(docFn(db, "users", userId, "objectives", encodeDocId(blockId)), basePayload, { merge: false }),
        ...shards.slice(1).map((chunk, i) =>
          put(
            docFn(db, "users", userId, "objectives", encodeDocId(`${blockId}${SHARD_SUFFIX}${i + 1}`)),
            { data: stripUndefined(chunk), updatedAt: stamp() },
            { merge: false }
          )
        ),
        ...staleDeletes,
      ]).then(() => {
        state.error = null;
        notifyStoreChanged(key, { userId, blockId, source: "firestore-write-complete" });
      }).catch((e) => reportWriteError(userId, blockId, e));
    } else {
      state.shardCounts.set(blockId, 1);
      // Delete any stale shard docs from a previous oversized write.
      const staleDeletes = [];
      for (let i = 1; i < prevShardCount; i++) {
        staleDeletes.push(del(docFn(db, "users", userId, "objectives", encodeDocId(`${blockId}${SHARD_SUFFIX}${i}`))));
      }
      Promise.all([
        put(
          docFn(db, "users", userId, "objectives", encodeDocId(blockId)),
          { data: clean, updatedAt: stamp() },
          { merge: false }
        ),
        ...staleDeletes,
      ]).then(() => {
        state.error = null;
        notifyStoreChanged(key, { userId, blockId, source: "firestore-write-complete" });
      }).catch((e) => reportWriteError(userId, blockId, e));
    }
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
