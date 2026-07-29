// rxt-assessments — Firestore-first (Phase B). Shell-only: App.jsx never reads
// this key, so it needs no local mirror and stops costing localStorage entirely.
//
// Conflict policy was a shallow merge by block id, because the schedule .md is
// the source of truth for what is scheduled and a re-import must be able to
// REMOVE a cancelled event. That policy lives in `merge` below for the legacy
// sync path; with one source of truth a write is simply a write.
import {
  isHydrated as cloudIsHydrated,
  readCloud,
  readError as cloudReadError,
  subscribeToCloudStore,
  writeCloud,
} from "./cloudBase.js";
import { readJson } from "./base.js";

export const key = "rxt-assessments";
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

// The sync path: the incoming list for a block wins.
export function merge(userId, incoming) {
  return write(userId, { ...(read(userId) || {}), ...(incoming || {}) });
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
