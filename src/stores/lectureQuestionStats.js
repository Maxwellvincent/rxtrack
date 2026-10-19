import { excludedEvidenceKeys, evidenceIdentity } from "../engine/questionScoringPolicy.js";
import * as questionRatings from "./questionRatings.js";
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
  writeCloudAwait,
} from "./cloudBase.js";
import { readJson, writeJson } from "./base.js";
import { mergeQuestionStats } from "./merge.js";

export const key = "rxt-lecture-qstats";
const fallback = {};

function readStored(userId) {
  if (!userId) return readJson(userId, key, fallback) || fallback;
  return readCloud(userId, key, fallback) || fallback;
}

export function read(userId) {
 const stored = readStored(userId);
 const excluded = excludedEvidenceKeys(questionRatings.read(userId).ratings);
 const evidence = userId ? readCloud(userId, "rxt-learner-evidence-v1", {}) : readJson(userId, "rxt-learner-evidence-v1", {});
 const next = { ...stored };
 for (const event of evidence?.evidenceJournal || []) {
  if (event.pendingLectureStats && event.lectureId && !excluded.has(evidenceIdentity(event.questionKey))) {
   const row = next[event.lectureId] || { answered: 0, correct: 0 };
   next[event.lectureId] = { ...row, answered: (Number(row.answered) || 0) + Number(!row.statsEventKeys?.includes(evidenceIdentity(event.eventId))),
    correct: (Number(row.correct) || 0) + Number(event.correct && !row.statsEventKeys?.includes(evidenceIdentity(event.eventId))),
    checkpointEventIds: [...(row.checkpointEventIds || []), event.eventId] };
   continue;
  }
  if (event.pendingLectureStats) continue;
  if (!event.lectureId || !excluded.has(evidenceIdentity(event.questionKey))) continue;
  const row = next[event.lectureId];
  if (!row) continue;
  next[event.lectureId] = { ...row, answered: Math.max(0, (Number(row.answered) || 0) - 1), correct: Math.max(0, (Number(row.correct) || 0) - (event.correct ? 1 : 0)) };
 }
 return next;
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
  const current = readStored(userId);
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

/**
 * Awaitable, non-swallowing sibling of `recordAnswer` — mirrors its logic
 * exactly but uses `writeCloudAwait` for the cloud path, so a caller can
 * know for certain whether the write landed before marking a completion
 * marker true. Used only by the exam-tab finalization path (a later task);
 * `recordAnswer` keeps being used by objectives quizzes exactly as today.
 */
export async function recordAnswerAwait(userId, lectureId, wasCorrect, eventId = null) {
  if (!lectureId) return read(userId);
  const current = readStored(userId);
  const prev = current[lectureId] || {};
  const eventKey = eventId ? evidenceIdentity(eventId) : null;
  if (eventKey && prev.statsEventKeys?.includes(eventKey)) {
    // A prior write may have updated the local cache before failing remotely.
    if (userId) await writeCloudAwait(userId, key, current);
    return current;
  }
  const next = mergeQuestionStats(current, {
    [lectureId]: {
      answered: (prev.answered || 0) + 1,
      correct: (prev.correct || 0) + (wasCorrect ? 1 : 0),
      at: Date.now(),
    },
  });
  if (eventKey) next[lectureId].statsEventKeys = [...new Set([...(prev.statsEventKeys || []), eventKey])];
  if (!userId) {
    writeJson(userId, key, next);
    return next;
  }
  await writeCloudAwait(userId, key, next);
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
  const { [lectureId]: _dropped, ...rest } = readStored(userId) || {};
  write(userId, rest);
  return rest;
}

export function subscribe(cb) {
  const off = subscribeToCloudStore(key, cb);
  const offRatings = questionRatings.subscribe(cb);
  const offEvidence = subscribeToCloudStore("rxt-learner-evidence-v1", cb);
  return () => { off(); offRatings(); offEvidence(); };
}

export function isHydrated(userId) {
  return !userId || cloudIsHydrated(userId, key);
}
