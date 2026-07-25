// rxt-completion conflict policy: keep max completionLevel, use the newer side's reviewDates, and union activityLog by stable id/fingerprint.
import { readJson, writeJson, subscribeToStore } from "./base.js";
import { mergeCompletion } from "./merge.js";

export const key = "rxt-completion";
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
  return writeJson(userId, key, incoming, { fallback, merge: mergeCompletion });
}

export function subscribe(cb) {
  return subscribeToStore(key, cb);
}
