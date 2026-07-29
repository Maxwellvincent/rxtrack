// rxt-mcq-bank conflict policy: additive KV merge keyed by `${objectiveId}_r${round}`.
//
// Every question generated is kept in the Firestore `mcq` collection. This local
// copy is a cache and is capped: unbounded, it was ~290KB of a ~5MB budget and
// grew with every drill.
import { readJson, writeJson, subscribeToStore } from "./base.js";
import { mergeKvValue } from "./merge.js";
import { applyLocalCap } from "./capped.js";

export const key = "rxt-mcq-bank";
const fallback = {};

export function read(userId) {
  return readJson(userId, key, fallback);
}

// Authoritative replace — what a local UI write means (a delete must stay deleted).
export function write(userId, value) {
  return writeJson(userId, key, applyLocalCap(key, value));
}

// Merge incoming into stored under this key's conflict policy — the sync path.
export function merge(userId, incoming) {
  const merged = writeJson(userId, key, incoming, { fallback, merge: mergeKvValue });
  const capped = applyLocalCap(key, merged);
  return capped === merged ? merged : writeJson(userId, key, capped);
}

export function subscribe(cb) {
  return subscribeToStore(key, cb);
}
