/**
 * rxt-calibration — the study path's answer log, Firestore-first.
 *
 * Not to be confused with `stores/calibration.js` (`rxt-calibration-log`), which is the older
 * App.jsx log: a flat array of percent-confidence entries. This one is what AtomQuiz and
 * CalibrationSession write — `{ [blockId]: [{ ts, concept, confidence, correct }] }` — and it is
 * what the accuracy-by-confidence curve and the landmine list are built from. The two have
 * different keys, shapes and readers; they are deliberately left separate.
 *
 * Append-only: a new answer merges into what is already stored rather than replacing it, so two
 * devices can both be studying and neither loses answers. Signed out it still works, straight
 * out of localStorage.
 */
import {
  isHydrated as cloudIsHydrated,
  readCloud,
  subscribeToCloudStore,
  writeCloud,
} from "./cloudBase.js";
import { readJson, writeJson } from "./base.js";
import { mergeCalibration } from "./merge.js";

export const key = "rxt-calibration";
const fallback = {};

export function read(userId) {
  if (!userId) return readJson(userId, key, fallback) || fallback;
  return readCloud(userId, key, fallback) || fallback;
}

export function write(userId, value) {
  if (!userId) return writeJson(userId, key, value);
  return writeCloud(userId, key, value);
}

/** One block's answers, oldest first. */
export function readBlock(userId, blockId) {
  const all = read(userId);
  return Array.isArray(all?.[blockId]) ? all[blockId] : [];
}

/** Append one answer. Identity is concept + timestamp — see mergeCalibration. */
export function appendRecord(userId, blockId, record) {
  if (!blockId || !record?.concept) return read(userId);
  const next = mergeCalibration(read(userId), { [blockId]: [{ ts: Date.now(), ...record }] });
  write(userId, next);
  return next;
}

export function subscribe(cb) {
  return subscribeToCloudStore(key, cb);
}

export function isHydrated(userId) {
  return !userId || cloudIsHydrated(userId, key);
}
