// rxt-terms conflict policy: union terms by id, union nested blocks by id, and let incoming scalar term fields win.
import { readJson, writeJson, subscribeToStore } from "./base.js";
import { mergeTerms } from "./merge.js";

export const key = "rxt-terms";
const fallback = [];

export function read(userId) {
  return readJson(userId, key, fallback);
}

export function write(userId, value) {
  return writeJson(userId, key, value, { fallback, merge: mergeTerms });
}

export function subscribe(cb) {
  return subscribeToStore(key, cb);
}
