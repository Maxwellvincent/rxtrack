// rxt-calibration-log conflict policy: append-only array union by JSON fingerprint, preserving existing order before incoming records.
import { readJson, writeJson, subscribeToStore } from "./base.js";
import { mergeKvValue } from "./merge.js";

export const key = "rxt-calibration-log";
const fallback = [];

export function read(userId) {
  return readJson(userId, key, fallback);
}

export function write(userId, value) {
  return writeJson(userId, key, value, { fallback, merge: mergeKvValue });
}

export function subscribe(cb) {
  return subscribeToStore(key, cb);
}
