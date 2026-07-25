// rxt-exam-dates conflict policy: shallow object merge by block id; incoming dates win for matching blocks.
import { readJson, writeJson, subscribeToStore } from "./base.js";

export const key = "rxt-exam-dates";
const fallback = {};
const mergeExamDates = (current = {}, next = {}) => ({ ...(current || {}), ...(next || {}) });

export function read(userId) {
  return readJson(userId, key, fallback);
}

export function write(userId, value) {
  return writeJson(userId, key, value, { fallback, merge: mergeExamDates });
}

export function subscribe(cb) {
  return subscribeToStore(key, cb);
}
