// rxt-exam-dates conflict policy: shallow object merge by block id; incoming dates win for matching blocks.
import { readJson, writeJson, subscribeToStore } from "./base.js";

export const key = "rxt-exam-dates";
const fallback = {};
const mergeExamDates = (current = {}, next = {}) => ({ ...(current || {}), ...(next || {}) });

export function read(userId) {
  return readJson(userId, key, fallback);
}

// Authoritative replace — what a local UI write means (a delete must stay deleted).
export function write(userId, value) {
  return writeJson(userId, key, value);
}

// Merge incoming into stored under this key's conflict policy — the sync path.
export function merge(userId, incoming) {
  return writeJson(userId, key, incoming, { fallback, merge: mergeExamDates });
}

export function subscribe(cb) {
  return subscribeToStore(key, cb);
}
