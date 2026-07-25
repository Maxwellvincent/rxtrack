// rxt-lec-meta conflict policy: union lectures by id and let incoming lecture metadata win, preserving unrelated existing lectures.
import { readJson, writeJson, subscribeToStore } from "./base.js";
import { mergeByIdArray } from "./merge.js";

export const key = "rxt-lec-meta";
const fallback = [];

export function read(userId) {
  return readJson(userId, key, fallback);
}

export function write(userId, value) {
  return writeJson(userId, key, value, { fallback, merge: mergeByIdArray });
}

export function subscribe(cb) {
  return subscribeToStore(key, cb);
}
