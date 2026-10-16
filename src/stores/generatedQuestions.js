/**
 * Per-lecture pool of AI-generated MCQs.
 *
 * Shape: { [lectureId]: { questions: MCQQuestion[], generatedAt: string } }
 *
 * Additive — new questions merge into the existing pool rather than replacing it.
 * This lets users build up a bank across multiple quiz runs without re-generating
 * questions they already have.
 *
 * Firestore is the source of truth through cloudBase. The legacy whole-pool KV
 * document is read for migration compatibility, but new writes use bounded
 * per-lecture chunks so the cache cannot grow past Firestore's 1 MiB limit.
 * Each lecture keeps up to 150 questions and the working set retains 30 lectures.
 */
import { readCloud, writeCloudAwait, subscribeToCloudStore, isHydrated as cloudIsHydrated, readError as cloudReadError } from "./cloudBase.js";
import { readJson, writeJson } from "./base.js";
import { areNearDuplicateQuestions } from "../engine/questionSimilarity.js";

export const key = "rxt-gen-questions";
const indexKey = "rxt-gen-questions-index-v2";
const fallback = {};
const MAX_SHARD_BYTES = 350_000;
let activeUserId = null;
let persistQueue = Promise.resolve();
let pendingPersistError = null;
const optimisticValues = new Map();
const shardKey = (lectureId, part) => `rxt-gen-questions-v2:${lectureId}:${part}`;

export function read(userId) {
  const cacheId = userId || "anon";
  if (optimisticValues.has(cacheId)) return optimisticValues.get(cacheId);
  if (!userId) return readJson(userId, key, fallback) || {};
  activeUserId = userId;
  const legacy = readCloud(userId, key, fallback) || {};
  const index = readCloud(userId, indexKey, null);
  if (!index) return legacy;
  const result = { ...legacy };
  for (const [lectureId, metadata] of Object.entries(index)) {
    if (metadata?.deleted) { delete result[lectureId]; continue; }
    if (!metadata || !Number.isInteger(metadata.parts)) continue;
    const questions = [];
    let complete = true;
    for (let part = 0; part < metadata.parts; part += 1) {
      const chunk = readCloud(userId, shardKey(lectureId, part), null);
      if (!Array.isArray(chunk)) { complete = false; break; }
      questions.push(...chunk);
    }
    // Keep serving the last legacy pool until all replacement shards hydrate.
    if (complete) result[lectureId] = { questions, generatedAt: metadata.generatedAt || "" };
  }
  return result;
}

function splitQuestions(questions) {
  const parts = [];
  let current = [];
  let bytes = 2;
  for (const question of questions) {
    const itemBytes = new TextEncoder().encode(JSON.stringify(question)).length + (current.length ? 1 : 0);
    if (itemBytes + 2 > MAX_SHARD_BYTES) throw new Error("A generated question is too large to save safely.");
    if (current.length && bytes + itemBytes > MAX_SHARD_BYTES) {
      parts.push(current);
      current = [];
      bytes = 2;
    }
    current.push(question);
    bytes += itemBytes;
  }
  if (current.length || !parts.length) parts.push(current);
  return parts;
}

async function persist(userId, value, previous) {
  if (!userId) {
    writeJson(userId, key, value);
    return value;
  }
  activeUserId = userId;
  const legacy = readCloud(userId, key, fallback) || {};
  const priorIndex = readCloud(userId, indexKey, null) || {};
  const nextIndex = {};
  const writes = [];
  for (const [lectureId, entry] of Object.entries(value || {})) {
    const oldEntry = previous?.[lectureId] ?? legacy[lectureId];
    if (priorIndex[lectureId] && !priorIndex[lectureId].deleted && JSON.stringify(oldEntry) === JSON.stringify(entry)) {
      nextIndex[lectureId] = priorIndex[lectureId];
      continue;
    }
    const parts = splitQuestions(entry?.questions || []);
    parts.forEach((part, i) => writes.push(writeCloudAwait(userId, shardKey(lectureId, i), part)));
    nextIndex[lectureId] = { parts: parts.length, generatedAt: entry?.generatedAt || new Date().toISOString() };
  }
  for (const lectureId of new Set([...Object.keys(legacy), ...Object.keys(priorIndex)])) {
    if (!Object.prototype.hasOwnProperty.call(value || {}, lectureId)) nextIndex[lectureId] = { deleted: true, updatedAt: Date.now() };
  }
  // Publish the index only after every replacement chunk is confirmed saved.
  await Promise.all(writes);
  await writeCloudAwait(userId, indexKey, nextIndex);
  return value;
}

function queuePersist(userId, value, previous) {
  optimisticValues.set(userId || "anon", value);
  persistQueue = persistQueue.then(() => persist(userId, value, previous)).then((saved) => {
    pendingPersistError = null;
    if (userId) {
      if (optimisticValues.get(userId) === saved) optimisticValues.delete(userId);
    } else optimisticValues.set("anon", saved);
  }).catch((error) => {
    pendingPersistError = error;
    console.warn("generated questions: save failed; current quiz remains usable but this update was not confirmed in Firestore", error?.message || error);
  });
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
  queuePersist(userId, capped, current);
  if (!userId) writeJson(userId, key, capped);
  return capped;
}

/** Seen is separate from answered: displaying an item never awards performance credit. */
export function isQuestionUnseen(question) {
  return (Number(question?.timesAnswered) || 0) === 0 && !question?.firstPresentedAt;
}

export function recordPresentation(userId, lectureId, stem) {
  const current = read(userId);
  const entry = current[lectureId];
  if (!entry || !stem) return current;
  const stemKey = normalizedStem(stem);
  const target = entry.questions.find(question => normalizedStem(question.stem) === stemKey);
  if (!target || target.firstPresentedAt) return current;
  const questions = entry.questions.map(question => question === target
    ? { ...question, firstPresentedAt: new Date().toISOString() } : question);
  const next = { ...current, [lectureId]: { ...entry, questions } };
  queuePersist(userId, next, current);
  return next;
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
    lastCorrect: !!correct,
    lastAnsweredAt: new Date().toISOString(),
  } : question);
  const next = { ...current, [lectureId]: { ...entry, questions } };
  queuePersist(userId, next, current);
  return next;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Answered questions leave the adaptive reserve. They return only for deliberate
 * review: immediately after the latest miss, or after a success-based spacing gap.
 */
export function isQuestionReviewDue(question, now = Date.now()) {
  const answered = Number(question?.timesAnswered) || 0;
  if (!answered) return false;
  const correct = Number(question?.timesCorrect) || 0;
  const latestWasWrong = question?.lastCorrect === false
    || (question?.lastCorrect == null && correct < answered);
  if (latestWasWrong) return true;
  const lastAnsweredAt = Date.parse(question?.lastAnsweredAt || "");
  if (!Number.isFinite(lastAnsweredAt)) return true;
  const successfulReviews = Math.max(1, correct);
  const spacingDays = successfulReviews === 1 ? 3 : successfulReviews === 2 ? 7 : 14;
  return Number(now) - lastAnsweredAt >= spacingDays * DAY_MS;
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
  queuePersist(userId, next, current);
  return next;
}

export function setHighlights(userId, lectureId, stem, highlights) {
  const current = read(userId);
  const entry = current[lectureId];
  if (!entry) return current;
  const questions = entry.questions.map(q => q.stem === stem ? { ...q, highlights } : q);
  const next = { ...current, [lectureId]: { ...entry, questions } };
  queuePersist(userId, next, current);
  return next;
}

export function questionsForLecture(userId, lectureId) {
  return read(userId)[lectureId]?.questions ?? [];
}

/** All retained generated questions, used to keep new quizzes fresh across blocks. */
export function questionsForAllLectures(userId) {
  return Object.values(read(userId) || {}).flatMap((entry) => entry?.questions || []);
}

export function countForLecture(userId, lectureId) {
  return questionsForLecture(userId, lectureId).length;
}

export function subscribe(cb) {
  let shardUnsubs = [];
  const subscribeShards = () => {
    shardUnsubs.forEach((unsub) => unsub());
    const index = activeUserId ? (readCloud(activeUserId, indexKey, {}) || {}) : {};
    shardUnsubs = activeUserId ? Object.entries(index).filter(([, metadata]) => !metadata?.deleted).flatMap(([lectureId, metadata]) =>
      Array.from({ length: Math.max(0, Number(metadata?.parts) || 0) }, (_, part) =>
        subscribeToCloudStore(shardKey(lectureId, part), cb))) : [];
    cb();
  };
  const unsubs = [subscribeToCloudStore(key, cb), subscribeToCloudStore(indexKey, subscribeShards)];
  return () => { unsubs.forEach((unsub) => unsub()); shardUnsubs.forEach((unsub) => unsub()); };
}

export function isHydrated(userId) {
  if (!userId) return true;
  activeUserId = userId;
  if (!cloudIsHydrated(userId, key) || !cloudIsHydrated(userId, indexKey)) return false;
  const index = readCloud(userId, indexKey, {}) || {};
  return Object.entries(index).filter(([, metadata]) => !metadata?.deleted).every(([lectureId, metadata]) =>
    Array.from({ length: Math.max(0, Number(metadata?.parts) || 0) }, (_, part) =>
      cloudIsHydrated(userId, shardKey(lectureId, part))).every(Boolean));
}

export function readError(userId) {
  if (!userId) return null;
  const index = readCloud(userId, indexKey, {}) || {};
  return cloudReadError(userId, key) || cloudReadError(userId, indexKey) ||
    Object.entries(index).filter(([, metadata]) => !metadata?.deleted).flatMap(([lectureId, metadata]) =>
      Array.from({ length: Math.max(0, Number(metadata?.parts) || 0) }, (_, part) =>
        cloudReadError(userId, shardKey(lectureId, part)))).find(Boolean) || null;
}

/** Await queued shard writes and reject if the latest save attempt was not confirmed. */
export async function flushPendingWrites() {
  await persistQueue;
  if (pendingPersistError) throw pendingPersistError;
}
