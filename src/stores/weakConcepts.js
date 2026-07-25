// rxt-weak-concepts conflict policy: union concepts per block by id/concept and keep the entry with the highest missCount.
import { readJson, writeJson, subscribeToStore } from "./base.js";
import { mergeWeakConcepts } from "./merge.js";

export const key = "rxt-weak-concepts";
const fallback = {};

export function read(userId) {
  return readJson(userId, key, fallback);
}

export function write(userId, value) {
  return writeJson(userId, key, value, { fallback, merge: mergeWeakConcepts });
}

export function subscribe(cb) {
  return subscribeToStore(key, cb);
}
