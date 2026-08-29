/**
 * Per-lecture pool of AI-generated MCQs.
 *
 * Shape: { [lectureId]: { questions: MCQQuestion[], generatedAt: string } }
 *
 * Additive — new questions merge into the existing pool rather than replacing it.
 * This lets users build up a bank across multiple quiz runs without re-generating
 * questions they already have.
 *
 * Capped to 30 lectures to stay within localStorage budget. A lecture with 100
 * questions at ~400 bytes each is ~40KB; 30 lectures = ~1.2MB, well under 5MB.
 */
import { readCloud, writeCloud, subscribeToCloudStore } from "./cloudBase.js";

export const key = "rxt-gen-questions";

export function read(userId) {
  return readCloud(userId, key, {}) ?? {};
}

/**
 * Merge new questions into the stored pool for a lecture.
 * Deduplicates by stem to avoid exact repeats across runs.
 */
export function addQuestions(userId, lectureId, newQuestions) {
  if (!lectureId || !newQuestions?.length) return;
  const current = read(userId);
  const existing = current[lectureId]?.questions ?? [];
  const existingStems = new Set(existing.map((q) => q.stem));
  const fresh = newQuestions.filter((q) => !existingStems.has(q.stem));
  const merged = [...existing, ...fresh];
  const next = {
    ...current,
    [lectureId]: { questions: merged, generatedAt: new Date().toISOString() },
  };
  // Cap to 30 most-recently-updated lectures
  const entries = Object.entries(next).sort(
    (a, b) => String(b[1].generatedAt || "").localeCompare(String(a[1].generatedAt || ""))
  );
  const capped = Object.fromEntries(entries.slice(0, 30));
  writeCloud(userId, key, capped);
  return capped;
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
