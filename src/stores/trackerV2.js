// rxt-tracker-v2 conflict policy: additive KV merge — matches the tracker pull in supabase.js.
import { readJson, writeJson, subscribeToStore } from "./base.js";
import { mergeKvValue } from "./merge.js";

export const key = "rxt-tracker-v2";
const fallback = null;

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
