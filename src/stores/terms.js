// rxt-terms — Firestore-first (Phase B), MIRRORED.
//
// App.jsx reads this key 15 times straight out of localStorage, so cloudBase
// keeps a local shadow in step: Firestore is the source of truth, the shell
// reads it, and App keeps seeing an up-to-date copy until its surfaces are
// gone. The mirror is listed in cloudBase's MIRRORED_TO_LOCAL and removed from
// there when T6.1 deletes the last App reader.
//
// Conflict policy was: union terms by id, union nested blocks by id, incoming
// scalar fields win. That reconciled two full copies; it survives in `merge`
// for the legacy sync path only.
import {
  isHydrated as cloudIsHydrated,
  readCloud,
  readError as cloudReadError,
  subscribeToCloudStore,
  writeCloud,
} from "./cloudBase.js";
import { readJson } from "./base.js";
import { mergeTerms } from "./merge.js";

export const key = "rxt-terms";
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
  return write(userId, mergeTerms(read(userId) || fallback, incoming));
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
