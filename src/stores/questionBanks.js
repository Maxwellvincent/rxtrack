/**
 * rxt-question-banks — Firestore-first, one kv document.
 *
 * Uploaded exam questions, keyed by source filename. They are read as few-shot
 * exemplars when generating questions, which is the reason this survived App's
 * retirement while the rest of the exam tooling did not.
 *
 * NOT mirrored to localStorage: the only reader that needed a synchronous local
 * copy was App.jsx, and the shell reads this store. 51 files was 618KB of a
 * ~5MB budget.
 */
import {
  isHydrated as cloudIsHydrated,
  readCloud,
  readError as cloudReadError,
  subscribeToCloudStore,
  writeCloud,
} from "./cloudBase.js";
import { readJson } from "./base.js";

export const key = "rxt-question-banks";
const fallback = {};

export function read(userId) {
  if (!userId) return readJson(userId, key, fallback);
  return readCloud(userId, key, fallback);
}

// Authoritative replace — removing a bank has to stay removed.
export function write(userId, value) {
  if (!userId) return value;
  return writeCloud(userId, key, value);
}

/** Add or replace one file's questions, leaving the other banks alone. */
export function saveBank(userId, filename, questions) {
  if (!filename) return read(userId);
  return write(userId, { ...(read(userId) || {}), [filename]: questions });
}

export function removeBank(userId, filename) {
  const next = { ...(read(userId) || {}) };
  delete next[filename];
  return write(userId, next);
}

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
