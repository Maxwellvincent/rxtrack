// rxt-weak-concepts conflict policy: union concepts per block by id/concept and keep the entry with the highest missCount.
import { readJson, writeJson, subscribeToStore } from "./base.js";
import { mergeWeakConcepts } from "./merge.js";

export const key = "rxt-weak-concepts";
const fallback = {};

export function read(userId) {
  return readJson(userId, key, fallback);
}

// Authoritative replace — what a local UI write means (a delete must stay deleted).
export function write(userId, value) {
  return writeJson(userId, key, value);
}

// Merge incoming into stored under this key's conflict policy — the sync path.
export function merge(userId, incoming) {
  return writeJson(userId, key, incoming, { fallback, merge: mergeWeakConcepts });
}

export function subscribe(cb) {
  return subscribeToStore(key, cb);
}
