// rxt-mcq-bank conflict policy: additive KV merge keyed by `${objectiveId}_r${round}`.
import { readJson, writeJson, subscribeToStore } from "./base.js";
import { mergeKvValue } from "./merge.js";

export const key = "rxt-mcq-bank";
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
  return writeJson(userId, key, incoming, { fallback, merge: mergeKvValue });
}

export function subscribe(cb) {
  return subscribeToStore(key, cb);
}
