/**
 * rxt-atom-progress — per-atom mastery, Firestore-first.
 *
 * The ground truth for "have I actually learned this" used to be split across a round counter
 * (how far through the queue) and a lecture-wide question tally (how much work happened) — neither
 * one knew whether any SPECIFIC atom had ever been answered correctly. This store closes that gap:
 * one record per atom, keyed the same way images and cross-lecture recurrence already key atoms
 * (`normAtomKey(term)`), so a miss can point back at exactly the thing to go re-study.
 *
 * Shape: `{ [lectureId]: { [atomKey]: { status, correctCount, missCount, lastAt } } }`.
 *
 * `status` is "complete" once the atom has been answered correctly at least once, "needs-review"
 * from the first miss until the next correct answer. Mastery is not permanent: a later miss on an
 * already-complete atom flips it back to needs-review, same spirit as "struggling" already being a
 * real state objectives can fall back into near an exam.
 */
import {
  isHydrated as cloudIsHydrated,
  readCloud,
  subscribeToCloudStore,
  writeCloud,
} from "./cloudBase.js";
import { readJson, writeJson } from "./base.js";
import { mergeAtomProgress } from "./merge.js";

export const key = "rxt-atom-progress";
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
 * Record one answered question against the atom it was actually about.
 *
 * `atomKey` is the caller's job to compute (`normAtomKey(atom.term)`) — this store doesn't know
 * what an atom is, only how to track outcomes against a key.
 */
export function recordAtomAnswer(userId, lectureId, atomKey, wasCorrect) {
  if (!lectureId || !atomKey) return read(userId);
  const current = read(userId);
  const prevLecture = current[lectureId] || {};
  const prev = prevLecture[atomKey] || { correctCount: 0, missCount: 0 };
  const entry = {
    status: wasCorrect ? "complete" : "needs-review",
    correctCount: prev.correctCount + (wasCorrect ? 1 : 0),
    missCount: prev.missCount + (wasCorrect ? 0 : 1),
    lastAt: Date.now(),
  };
  const next = mergeAtomProgress(current, {
    [lectureId]: { ...prevLecture, [atomKey]: entry },
  });
  write(userId, next);
  return next;
}

/** One lecture's atom-progress map, `{}` if never touched. */
export function progressForLecture(userId, lectureId) {
  if (!lectureId) return {};
  return read(userId)[lectureId] || {};
}

/**
 * `{ masteredCount, totalCount }` against the atom list actually on the lecture right now — an
 * atom that no longer exists (re-extraction changed the set) doesn't count either way.
 */
export function masterySummary(userId, lectureId, atomKeys) {
  const keys = Array.isArray(atomKeys) ? atomKeys : [];
  const progress = progressForLecture(userId, lectureId);
  const masteredCount = keys.filter((k) => progress[k]?.status === "complete").length;
  return { masteredCount, totalCount: keys.length };
}

/** Atom keys currently flagged needs-review, most recently missed first. */
export function needsReview(userId, lectureId) {
  const progress = progressForLecture(userId, lectureId);
  return Object.entries(progress)
    .filter(([, entry]) => entry?.status === "needs-review")
    .sort((a, b) => (b[1].lastAt || 0) - (a[1].lastAt || 0))
    .map(([atomKey]) => atomKey);
}

/** Forget one lecture's atom progress — pairs with clearing its round/question progress. */
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
