/**
 * rxt-performance — Firestore-first (Phase B), MIRRORED.
 *
 * App.jsx reads this key 41 times straight out of localStorage, so cloudBase keeps
 * a localStorage shadow in step until those surfaces are gone. Remove the key from
 * MIRRORED_TO_LOCAL in cloudBase.js when the last App reader goes and it stops
 * costing storage.
 *
 * Conflict policy was: union session history per lecture key, dedupe near-identical sessions within 90 seconds,
 * cap to the latest 50 sessions, and recompute score.
 * That reconciled two full copies; it survives in `merge` for the legacy sync
 * path only.
 */
import {
  isHydrated as cloudIsHydrated,
  readCloud,
  readError as cloudReadError,
  subscribeToCloudStore,
  writeCloud,
} from "./cloudBase.js";
import { readJson } from "./base.js";
import { mergePerformance } from "./merge.js";

export const key = "rxt-performance";
const fallback = {};

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
  return write(userId, mergePerformance(read(userId) || fallback, incoming));
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
