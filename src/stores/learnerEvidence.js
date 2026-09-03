import { readCloud, subscribeToCloudStore, writeCloud, writeCloudAwait } from "./cloudBase.js";
import { readJson, writeJson } from "./base.js";

export const key = "rxt-learner-evidence-v1";
const fallback = { version: 1, total: 0, correct: 0, objectives: {}, atoms: {}, lectures: {}, sources: {}, taskTypes: {}, testTaking: { reasons: {}, timedAnswers: 0, totalResponseMs: 0, answerChanges: 0 } };

export function read(userId) {
  return userId ? readCloud(userId, key, fallback) || fallback : readJson(userId, key, fallback) || fallback;
}

function bump(bucket, id, event) {
  if (!id) return bucket;
  const prev = bucket[id] || {};
  return {
    ...bucket,
    [id]: {
      attempts: (prev.attempts || 0) + 1,
      correct: (prev.correct || 0) + (event.correct ? 1 : 0),
      landmines: (prev.landmines || 0) + (event.misconception === "landmine" ? 1 : 0),
      lastSeen: event.at,
      lastDifficulty: event.difficulty || prev.lastDifficulty || null,
      recent: [...(prev.recent || []), !!event.correct].slice(-8),
    },
  };
}

export function applyEvidence(model, rawEvent) {
  const current = model || fallback;
  const event = { ...rawEvent, at: rawEvent?.at || Date.now() };
  let objectives = current.objectives || {};
  for (const id of [...new Set(event.objectiveIds || [])]) objectives = bump(objectives, id, event);
  const process = current.testTaking || fallback.testTaking;
  const responseMs = Number.isFinite(event.responseMs) ? Math.max(0, event.responseMs) : null;
  return {
    ...current,
    version: 1,
    total: (current.total || 0) + 1,
    correct: (current.correct || 0) + (event.correct ? 1 : 0),
    updatedAt: event.at,
    objectives,
    atoms: bump(current.atoms || {}, event.atomKey, event),
    lectures: bump(current.lectures || {}, event.lectureId, event),
    sources: bump(current.sources || {}, event.source || "quiz", event),
    taskTypes: bump(current.taskTypes || {}, event.taskType, event),
    testTaking: {
      ...process,
      reasons: process.reasons || {},
      timedAnswers: (process.timedAnswers || 0) + (responseMs == null ? 0 : 1),
      totalResponseMs: (process.totalResponseMs || 0) + (responseMs || 0),
      answerChanges: (process.answerChanges || 0) + (event.answerChanges || 0),
    },
  };
}

export function applyReflection(model, reason, previousReason = null) {
  const current = model || fallback;
  if (!reason || reason === previousReason) return current;
  const process = current.testTaking || fallback.testTaking;
  const reasons = { ...(process.reasons || {}) };
  if (previousReason) reasons[previousReason] = Math.max(0, (reasons[previousReason] || 0) - 1);
  reasons[reason] = (reasons[reason] || 0) + 1;
  return {
    ...current,
    updatedAt: Date.now(),
    testTaking: {
      ...process,
      reasons,
    },
  };
}

export function recordReflection(userId, reason, previousReason = null) {
  if (!reason) return read(userId);
  const next = applyReflection(read(userId), reason, previousReason);
  if (userId) writeCloud(userId, key, next);
  else writeJson(userId, key, next);
  return next;
}

export function recordEvidence(userId, event) {
  const next = applyEvidence(read(userId), event);
  if (userId) writeCloud(userId, key, next);
  else writeJson(userId, key, next);
  return next;
}

export async function recordEvidenceAwait(userId, event) {
  const next = applyEvidence(read(userId), event);
  if (userId) await writeCloudAwait(userId, key, next);
  else writeJson(userId, key, next);
  return next;
}

export function subscribe(cb) {
  return subscribeToCloudStore(key, cb);
}
