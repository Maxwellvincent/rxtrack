// rxt-exam-dates — the first store converted to Firestore as the source of truth
// (see docs/plans/2026-07-29-firestore-first-read-path.md, Phase A).
//
// Chosen to go first because it is small, read by one surface, and easy to eyeball
// against the live account. The document it reads is the one the old sync already
// wrote — users/{uid}/kv/rxt-exam-dates — so there is no migration.
//
// `merge` is kept for the legacy sync path while that still runs; it is a plain
// authoritative write now, because with one source of truth there is no second
// copy to reconcile. It disappears with the rest of the sync machinery in Phase C.
import {
  isHydrated as cloudIsHydrated,
  readCloud,
  readError as cloudReadError,
  subscribeToCloudStore,
  writeCloud,
} from "./cloudBase.js";
import { readJson } from "./base.js";

export const key = "rxt-exam-dates";
const fallback = {};

/**
 * Signed out there is no document to read, so fall back to whatever the old
 * localStorage copy holds. That keeps a logged-out boot and the existing tests
 * working while the rest of the stores are still local.
 */
export function read(userId) {
  if (!userId) return readJson(userId, key, fallback);
  return readCloud(userId, key, fallback);
}

// Authoritative replace — what a local UI write means (a delete must stay deleted).
export function write(userId, value) {
  if (!userId) return value;
  return writeCloud(userId, key, value);
}

// The sync path still calls this; incoming dates win for matching blocks.
export function merge(userId, incoming) {
  const next = { ...(read(userId) || {}), ...(incoming || {}) };
  return write(userId, next);
}

export function subscribe(cb) {
  return subscribeToCloudStore(key, cb);
}

/** Lets useStoreResource report a real loading state for this store. */
export function isHydrated(userId) {
  return cloudIsHydrated(userId, key);
}

export function readError(userId) {
  return cloudReadError(userId, key);
}
