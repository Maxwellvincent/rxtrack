/**
 * Per-lecture pool of AI-generated MCQs.
 *
 * Shape: { [lectureId]: { questions: MCQQuestion[], generatedAt: string } }
 *
 * Additive — new questions merge into the existing pool rather than replacing it.
 * This lets users build up a bank across multiple quiz runs without re-generating
 * questions they already have.
 *
 * Firestore is the source of truth through cloudBase. Each lecture keeps up to
 * 150 questions so a requested 50-100 item reserve has room for replacements,
 * while the most recently used 30 lectures remain available in this working set.
 */
import { readCloud, writeCloud, subscribeToCloudStore } from "./cloudBase.js";
import { areNearDuplicateQuestions } from "../engine/questionSimilarity.js";

export const key = "rxt-gen-questions";

export function read(userId) {
  return readCloud(userId, key, {}) ?? {};
}

/**
 * Merge new questions into the stored pool for a lecture.
 * Deduplicates by normalized stem to avoid punctuation/case-only repeats across runs.
 */
function normalizedStem(stem) {
  return String(stem || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function questionId(question) {
  const input = normalizedStem(question?.stem);
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `q_${(hash >>> 0).toString(36)}`;
}

export function addQuestions(userId, lectureId, newQuestions) {
  if (!lectureId || !newQuestions?.length) return;
  const current = read(userId);
  const existing = current[lectureId]?.questions ?? [];
  const existingStems = new Set(existing.map((q) => normalizedStem(q.stem)));
  const now = new Date().toISOString();
  const fresh = [];
  for (const question of newQuestions) {
    const stemKey = normalizedStem(question?.stem);
    if (!stemKey || existingStems.has(stemKey) || [...existing, ...fresh].some((other) => areNearDuplicateQuestions(question, other))) continue;
    existingStems.add(stemKey);
    fresh.push({
      ...question,
      id: question.id || questionId(question),
      createdAt: question.createdAt || now,
      timesAnswered: Number(question.timesAnswered) || 0,
      timesCorrect: Number(question.timesCorrect) || 0,
    });
  }
  const merged = [...existing, ...fresh];
  const next = {
    ...current,
    [lectureId]: { questions: merged.slice(-150), generatedAt: now },
  };
  // Cap to 30 most-recently-updated lectures
  const entries = Object.entries(next).sort(
    (a, b) => String(b[1].generatedAt || "").localeCompare(String(a[1].generatedAt || ""))
  );
  const capped = Object.fromEntries(entries.slice(0, 30));
  writeCloud(userId, key, capped);
  return capped;
}

/** Record reserve usage so future quizzes serve unseen questions first. */
export function recordUse(userId, lectureId, stem, correct) {
  if (!lectureId || !stem) return read(userId);
  const current = read(userId);
  const entry = current[lectureId];
  if (!entry) return current;
  const stemKey = normalizedStem(stem);
  const questions = entry.questions.map((question) => normalizedStem(question.stem) === stemKey ? {
    ...question,
    timesAnswered: (Number(question.timesAnswered) || 0) + 1,
    timesCorrect: (Number(question.timesCorrect) || 0) + (correct ? 1 : 0),
    lastAnsweredAt: new Date().toISOString(),
  } : question);
  const next = { ...current, [lectureId]: { ...entry, questions } };
  writeCloud(userId, key, next);
  return next;
}

/**
 * Add one highlighted phrase to a question, matched by stem (the same key
 * addQuestions dedupes on). No-op if the question isn't in the pool — a
 * highlight on a question that never got saved has nothing to attach to.
 */
export function addHighlight(userId, lectureId, stem, phrase) {
  if (!lectureId || !stem || !phrase) return read(userId);
  const current = read(userId);
  const entry = current[lectureId];
  if (!entry) return current;
  const questions = entry.questions.map((q) => {
    if (q.stem !== stem) return q;
    const existing = q.highlights || [];
    if (existing.includes(phrase)) return q;
    return { ...q, highlights: [...existing, phrase] };
  });
  const next = { ...current, [lectureId]: { ...entry, questions } };
  writeCloud(userId, key, next);
  return next;
}

export function setHighlights(userId, lectureId, stem, highlights) {
  const current = read(userId);
  const entry = current[lectureId];
  if (!entry) return current;
  const questions = entry.questions.map(q => q.stem === stem ? { ...q, highlights } : q);
  const next = { ...current, [lectureId]: { ...entry, questions } };
  writeCloud(userId, key, next);
  return next;
}

export function questionsForLecture(userId, lectureId) {
  return read(userId)[lectureId]?.questions ?? [];
}

export function countForLecture(userId, lectureId) {
  return questionsForLecture(userId, lectureId).length;
}

export function subscribe(cb) {
  return subscribeToCloudStore(key, cb);
}
