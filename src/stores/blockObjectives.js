// rxt-block-objectives conflict policy: merge per block; imported objectives union by id, preferring the side with more drill evidence; extracted objectives union by id.
import { readJson, writeJson, subscribeToStore } from "./base.js";
import { mergeObjectivesMap } from "./merge.js";

export const key = "rxt-block-objectives";
const fallback = {};

export function read(userId) {
  return readJson(userId, key, fallback);
}

export function write(userId, value) {
  return writeJson(userId, key, value, { fallback, merge: mergeObjectivesMap });
}

export function subscribe(cb) {
  return subscribeToStore(key, cb);
}
