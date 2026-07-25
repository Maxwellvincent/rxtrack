// rxt-completion conflict policy: keep max completionLevel, use the newer side's reviewDates, and union activityLog by stable id/fingerprint.
import { readJson, writeJson, subscribeToStore } from "./base.js";
import { mergeCompletion } from "./merge.js";

export const key = "rxt-completion";
const fallback = {};

export function read(userId) {
  return readJson(userId, key, fallback);
}

export function write(userId, value) {
  return writeJson(userId, key, value, { fallback, merge: mergeCompletion });
}

export function subscribe(cb) {
  return subscribeToStore(key, cb);
}
