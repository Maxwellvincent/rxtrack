/**
 * rxt-lecture-round — how far through each lecture you have studied, Firestore-first.
 *
 * Signed out this still works, straight out of localStorage, because studying offline on a
 * laptop that has never seen a login is a normal thing to do.
 *
 * Shape: `{ [lectureId]: { round, at } }` where `round` is the number of rounds COMPLETED,
 * which is also the index of the next one to run.
 */
import {
  isHydrated as cloudIsHydrated,
  readCloud,
  subscribeToCloudStore,
  writeCloud,
} from "./cloudBase.js";
import { readJson, writeJson } from "./base.js";
import { mergeRoundProgress } from "./merge.js";

export const key = "rxt-lecture-round";
const fallback = {};

export function read(userId) {
  if (!userId) return readJson(userId, key, fallback) || fallback;
  return readCloud(userId, key, fallback) || fallback;
}

export function write(userId, value) {
  if (!userId) return writeJson(userId, key, value);
  return writeCloud(userId, key, value);
}

/**
 * Record that `round` rounds of a lecture are done.
 *
 * Merged rather than replaced, and never backwards: re-running an earlier round to review it
 * must not discard the rest of the lecture, and a device that is behind must not undo one that
 * is ahead.
 */
export function markRoundDone(userId, lectureId, round) {
  if (!lectureId || !Number.isInteger(round) || round <= 0) return read(userId);
  const next = mergeRoundProgress(read(userId), { [lectureId]: { round, at: Date.now() } });
  write(userId, next);
  return next;
}

/** Forget one lecture's progress — "start over" on a lecture you want from the top. */
export function clearLecture(userId, lectureId) {
  if (!lectureId) return read(userId);
  const { [lectureId]: _dropped, ...rest } = read(userId) || {};
  write(userId, rest);
  return rest;
}

export function subscribe(cb) {
  return subscribeToCloudStore(key, cb);
}

export function isHydrated(userId) {
  return !userId || cloudIsHydrated(userId, key);
}
