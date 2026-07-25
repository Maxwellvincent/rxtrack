// rxt-performance conflict policy: union session history per lecture key, dedupe near-identical sessions within 90 seconds, cap to the latest 50 sessions, and recompute score.
import { readJson, writeJson, subscribeToStore } from "./base.js";
import { mergePerformance } from "./merge.js";

export const key = "rxt-performance";
const fallback = {};

export function read(userId) {
  return readJson(userId, key, fallback);
}

export function write(userId, value) {
  return writeJson(userId, key, value, { fallback, merge: mergePerformance });
}

export function subscribe(cb) {
  return subscribeToStore(key, cb);
}
