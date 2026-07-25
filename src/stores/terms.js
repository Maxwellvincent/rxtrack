// rxt-terms conflict policy: union terms by id, union nested blocks by id, and let incoming scalar term fields win.
import { readJson, writeJson, subscribeToStore } from "./base.js";
import { mergeTerms } from "./merge.js";

export const key = "rxt-terms";
const fallback = [];

export function read(userId) {
  return readJson(userId, key, fallback);
}

// Authoritative replace — what a local UI write means (a delete must stay deleted).
export function write(userId, value) {
  return writeJson(userId, key, value);
}

// Merge incoming into stored under this key's conflict policy — the sync path.
export function merge(userId, incoming) {
  return writeJson(userId, key, incoming, { fallback, merge: mergeTerms });
}

export function subscribe(cb) {
  return subscribeToStore(key, cb);
}
