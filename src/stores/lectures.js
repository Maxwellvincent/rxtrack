// rxt-lec-meta conflict policy: union lectures by id and let incoming lecture metadata win, preserving unrelated existing lectures.
import { readJson, writeJson, subscribeToStore } from "./base.js";
import { mergeByIdArray } from "./merge.js";

export const key = "rxt-lec-meta";
const fallback = [];
const projectionCache=new WeakMap();

export function read(userId) {
  const stored=readJson(userId,key,fallback)||fallback;
  if(!projectionCache.has(stored))projectionCache.set(stored,stored.filter(lecture=>!lecture?.mergedInto));
  return projectionCache.get(stored);
}

// Authoritative replace — what a local UI write means (a delete must stay deleted).
export function write(userId, value) {
  return writeJson(userId, key, value);
}

// Merge incoming into stored under this key's conflict policy — the sync path.
export function merge(userId, incoming) {
  return writeJson(userId, key, incoming, { fallback, merge: mergeByIdArray });
}

export function subscribe(cb) {
  return subscribeToStore(key, cb);
}

/** Cache a list after the uploaded lecture has been confirmed saved in Firestore. */
export function writeCloudSaved(userId, value) {
  if (!userId) return write(userId, value);
  return writeJson(userId, key, value, { cloudSaved: true });
}
