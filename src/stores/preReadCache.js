// rxt-preread-cache — generated pre-reads, local only.
//
// Deliberately NOT cloud-backed: this is a regenerable model output, not user
// data. Losing it on another device costs one background generation, while
// syncing it would put several KB of questions per lecture into Firestore for
// no gain.
import { readJson, writeJson, subscribeToStore } from "./base.js";

export const key = "rxt-preread-cache";
const fallback = {};

export function read(userId) {
  return readJson(userId, key, fallback);
}

export function write(userId, value) {
  return writeJson(userId, key, value);
}

export function subscribe(cb) {
  return subscribeToStore(key, cb);
}
