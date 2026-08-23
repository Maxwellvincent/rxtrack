/**
 * rxt-weak-concepts — Firestore-first (Phase B), MIRRORED.
 *
 * App.jsx reads this key 16 times straight out of localStorage, so cloudBase keeps
 * a localStorage shadow in step until those surfaces are gone. Remove the key from
 * MIRRORED_TO_LOCAL in cloudBase.js when the last App reader goes and it stops
 * costing storage.
 *
 * Conflict policy was: union concepts per block by id/concept and keep the entry with the highest missCount.
 * That reconciled two full copies; it survives in `merge` for the legacy sync
 * path only.
 */
import {
  isHydrated as cloudIsHydrated,
  readCloud,
  readError as cloudReadError,
  subscribeToCloudStore,
  writeCloud,
  writeCloudAwait,
} from "./cloudBase.js";
import { readJson } from "./base.js";
import { mergeWeakConcepts } from "./merge.js";

export const key = "rxt-weak-concepts";
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

// Awaitable, non-swallowing sibling of `write` — the returned promise
// genuinely reflects whether the Firestore write succeeded. Used only by
// the exam-tab finalization path (a later task); `write` is unchanged.
export async function writeAwait(userId, value) {
  if (!userId) return value;
  await writeCloudAwait(userId, key, value);
  return value;
}

export function merge(userId, incoming) {
  return write(userId, mergeWeakConcepts(read(userId) || fallback, incoming));
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
