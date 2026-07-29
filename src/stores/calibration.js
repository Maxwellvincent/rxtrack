// rxt-calibration-log — Firestore-first (Phase B). Shell-only: App.jsx never
// reads this key, so no local mirror is needed.
//
// Append-only log. The union-by-fingerprint merge existed to reconcile two
// devices' copies; with Firestore as the source of truth a write is a write,
// and `merge` keeps the old union only for the legacy sync path.
import {
  isHydrated as cloudIsHydrated,
  readCloud,
  readError as cloudReadError,
  subscribeToCloudStore,
  writeCloud,
} from "./cloudBase.js";
import { readJson } from "./base.js";
import { mergeKvValue } from "./merge.js";

export const key = "rxt-calibration-log";
const fallback = [];

export function read(userId) {
  if (!userId) return readJson(userId, key, fallback);
  return readCloud(userId, key, fallback);
}

// Authoritative replace — what a local UI write means (a delete must stay deleted).
export function write(userId, value) {
  if (!userId) return value;
  return writeCloud(userId, key, value);
}

export function merge(userId, incoming) {
  return write(userId, mergeKvValue(read(userId) || fallback, incoming));
}

export function subscribe(cb) {
  return subscribeToCloudStore(key, cb);
}

export function isHydrated(userId) {
  return cloudIsHydrated(userId, key);
}

export function readError(userId) {
  return cloudReadError(userId, key);
}
