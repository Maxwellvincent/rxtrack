// rxt-assessments conflict policy: shallow merge by block id; the incoming list
// for a block wins, because the schedule .md is the source of truth for what is
// scheduled — a re-import must be able to REMOVE an event that was cancelled.
import { readJson, writeJson, subscribeToStore } from "./base.js";

export const key = "rxt-assessments";
const fallback = {};
const mergeAssessments = (current = {}, next = {}) => ({ ...(current || {}), ...(next || {}) });

export function read(userId) {
  return readJson(userId, key, fallback);
}

// Authoritative replace — what a local UI write means (a delete must stay deleted).
export function write(userId, value) {
  return writeJson(userId, key, value);
}

// Merge incoming into stored under this key's conflict policy — the sync path.
export function merge(userId, incoming) {
  return writeJson(userId, key, incoming, { fallback, merge: mergeAssessments });
}

export function subscribe(cb) {
  return subscribeToStore(key, cb);
}
