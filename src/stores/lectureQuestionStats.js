/**
 * rxt-lecture-qstats — how many questions you have answered on each lecture, and how many you got
 * right, Firestore-first.
 *
 * Round progress already says how far through a lecture you are, but not how much work that was.
 * "Round 3 of 6" reads the same after four questions as after forty, so the list could not tell a
 * lecture you have drilled hard from one you opened twice. The count is also what makes review
 * ordering honest: a lecture with two answers and no misses is untested, not mastered.
 *
 * Shape: `{ [lectureId]: { answered, correct, at } }`. Both counters are cumulative across every
 * round and every re-run — re-answering a question you have seen still counts, because repetition
 * is the point of the rounds.
 */
import {
  isHydrated as cloudIsHydrated,
  readCloud,
  subscribeToCloudStore,
  writeCloud,
} from "./cloudBase.js";
import { readJson, writeJson } from "./base.js";
import { mergeQuestionStats } from "./merge.js";

export const key = "rxt-lecture-qstats";
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
 * Record one answered question.
 *
 * Written per answer rather than per round so that quitting a round mid-way still keeps the work
 * you did — the round bookmark is deliberately coarse, this is not.
 */
export function recordAnswer(userId, lectureId, wasCorrect) {
  if (!lectureId) return read(userId);
  const current = read(userId);
  const prev = current[lectureId] || {};
  const next = mergeQuestionStats(current, {
    [lectureId]: {
      answered: (prev.answered || 0) + 1,
      correct: (prev.correct || 0) + (wasCorrect ? 1 : 0),
      at: Date.now(),
    },
  });
  write(userId, next);
  return next;
}

/** `{ answered, correct, accuracy }` for one lecture; zeroes for one never quizzed. */
export function statsForLecture(userId, lectureId) {
  const entry = (lectureId && read(userId)[lectureId]) || {};
  const answered = Number.isFinite(entry.answered) ? entry.answered : 0;
  const correct = Number.isFinite(entry.correct) ? entry.correct : 0;
  return { answered, correct, accuracy: answered > 0 ? correct / answered : null };
}

/** Forget one lecture's counts — pairs with clearing its round progress. */
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
