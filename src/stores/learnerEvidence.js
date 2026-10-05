import { readCloud, subscribeToCloudStore, writeCloud, writeCloudAwait } from "./cloudBase.js";
import { readJson, writeJson } from "./base.js";

import * as questionRatings from "./questionRatings.js";

export const key = "rxt-learner-evidence-v1";
const fallback = { version: 1, total: 0, correct: 0, objectives: {}, atoms: {}, lectures: {}, sources: {}, taskTypes: {}, orderLevels: {}, testTaking: { reasons: {}, missTypes: {}, diagnosticKeys: [], positionStats: {}, timedAnswers: 0, totalResponseMs: 0, answerChanges: 0 } };

export function read(userId) {
  const stored = userId ? readCloud(userId, key, fallback) || fallback : readJson(userId, key, fallback) || fallback;
  if (!stored.evidenceJournal) return stored;
  const contested = new Set(Object.values(questionRatings.read(userId).ratings || {}).filter(r => r.sourceIssue).map(r => questionEvidenceKey(r.evidenceKey)));
  let projected = stored.evidenceBaseline || fallback;
  for (const event of stored.evidenceJournal) {
    if (!contested.has(questionEvidenceKey(event.questionKey))) projected = applyEvidence(projected, event);
  }
  return { ...stored, ...projected, evidenceBaseline: stored.evidenceBaseline, evidenceJournal: stored.evidenceJournal,
    testTaking: { ...projected.testTaking, reasons: stored.testTaking?.reasons || {}, missTypes: stored.testTaking?.missTypes || {}, diagnosticKeys: stored.testTaking?.diagnosticKeys || [] } };

}

/** Compact, stable identity used to keep exact-item history durable without storing full stems. */
export function questionEvidenceKey(value) {
  const input = String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
  if (!input) return "";
  if (/^e_[a-z0-9]+$/.test(input)) return input;
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `e_${(hash >>> 0).toString(36)}`;
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

function bumpObjective(bucket, id, event) {
  if (!id) return bucket;
  const previous = bucket[id] || {};
  const questionKey = questionEvidenceKey(event.questionKey);
  const questionKeys = previous.questionKeys || [];
  const repeatedQuestion = !!questionKey && questionKeys.includes(questionKey);
  if (repeatedQuestion) {
    const recent = event.correct
      ? previous.recent || []
      : [...(previous.recent || []), false].slice(-8);
    return {
      ...bucket,
      [id]: {
        ...previous,
        lastSeen: event.at,
        lastReinforcedAt: event.at,
        reinforcements: (previous.reinforcements || 0) + 1,
        reinforcementCorrect: (previous.reinforcementCorrect || 0) + (event.correct ? 1 : 0),
        recent,
      },
    };
  }
  const next = bump(bucket, id, event);
  const entry = next[id];
  const sessions = event.sessionKey
    ? [...new Set([...(previous.sessions || []), event.sessionKey])].slice(-12)
    : previous.sessions || [];
  const taskTypes = { ...(previous.taskTypes || {}) };
  if (event.taskType) taskTypes[event.taskType] = (taskTypes[event.taskType] || 0) + 1;
  const sources = { ...(previous.sources || {}) };
  const source = event.source || "quiz";
  sources[source] = (sources[source] || 0) + 1;
  const nextQuestionKeys = questionKey
    ? [...new Set([...questionKeys, questionKey])].slice(-200)
    : questionKeys;
  return { ...next, [id]: { ...entry, sessions, taskTypes, sources, questionKeys: nextQuestionKeys } };
}

export function applyEvidence(model, rawEvent) {
  const current = model || fallback;
  const event = { ...rawEvent, at: rawEvent?.at || Date.now() };
  let objectives = current.objectives || {};
  for (const id of [...new Set(event.objectiveIds || [])]) objectives = bumpObjective(objectives, id, event);
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
      orderLevels: bump(current.orderLevels || {}, event.orderLevel, event),
      testTaking: {
      ...process,
      reasons: process.reasons || {},
      missTypes: process.missTypes || {},
      diagnosticKeys: process.diagnosticKeys || [],
      positionStats: (() => {
        const position = Number(event.questionNumber);
        if (!Number.isInteger(position) || position < 1) return process.positionStats || {};
        const band = position <= 8 ? "first-eight" : "after-eight";
        const prior = process.positionStats?.[band] || { attempts: 0, correct: 0, totalResponseMs: 0, timedAnswers: 0 };
        const response = Number.isFinite(event.responseMs) ? Math.max(0, event.responseMs) : null;
        return { ...(process.positionStats || {}), [band]: {
          attempts: prior.attempts + 1,
          correct: prior.correct + (event.correct ? 1 : 0),
          totalResponseMs: prior.totalResponseMs + (response || 0),
          timedAnswers: prior.timedAnswers + (response == null ? 0 : 1),
        } };
      })(),
      reasoningDepths: event.reasoningDepth ? {
        ...(process.reasoningDepths || {}),
        [event.reasoningDepth]: (() => {
          const previous = process.reasoningDepths?.[event.reasoningDepth] || { attempts: 0, correct: 0 };
          return { attempts: previous.attempts + 1, correct: previous.correct + (event.correct ? 1 : 0) };
        })(),
      } : (process.reasoningDepths || {}),
      timedAnswers: (process.timedAnswers || 0) + (responseMs == null ? 0 : 1),
      totalResponseMs: (process.totalResponseMs || 0) + (responseMs || 0),
      answerChanges: (process.answerChanges || 0) + (event.answerChanges || 0),
    },
  };
}

export function applyMissType(model, missType, diagnosticKey, at = Date.now()) {
  if (!missType) return model || fallback;
  const current = model || fallback;
  const process = current.testTaking || fallback.testTaking;
  const key = questionEvidenceKey(diagnosticKey);
  const keys = process.diagnosticKeys || [];
  if (key && keys.includes(key)) return current;
  const previous = process.missTypes?.[missType] || { count: 0 };
  return {
    ...current,
    updatedAt: at,
    testTaking: {
      ...process,
      missTypes: { ...(process.missTypes || {}), [missType]: { count: (previous.count || 0) + 1, lastAt: at } },
      diagnosticKeys: key ? [...keys, key].slice(-500) : keys,
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
  const stored = userId ? readCloud(userId, key, fallback) || fallback : readJson(userId, key, fallback) || fallback;
  const baseline = stored.evidenceBaseline || stored;
  const journal = [...(stored.evidenceJournal || []), { ...event, at: event.at || Date.now() }];
  const next = { ...applyEvidence(stored, event), evidenceBaseline: baseline, evidenceJournal: journal };
  if (userId) writeCloud(userId, key, next);
  else writeJson(userId, key, next);
  return next;
}

export async function recordEvidenceAwait(userId, event) {
  const stored = userId ? readCloud(userId, key, fallback) || fallback : readJson(userId, key, fallback) || fallback;
  const baseline = stored.evidenceBaseline || stored;
  const journal = [...(stored.evidenceJournal || []), { ...event, at: event.at || Date.now() }];
  const next = { ...applyEvidence(stored, event), evidenceBaseline: baseline, evidenceJournal: journal };
  if (userId) await writeCloudAwait(userId, key, next);
  else writeJson(userId, key, next);
  return next;
}

export function recordMissType(userId, missType, diagnosticKey) {
  const next = applyMissType(read(userId), missType, diagnosticKey);
  if (userId) writeCloud(userId, key, next);
  else writeJson(userId, key, next);
  return next;
}

export async function recordMissTypeAwait(userId, missType, diagnosticKey) {
  const next = applyMissType(read(userId), missType, diagnosticKey);
  if (userId) await writeCloudAwait(userId, key, next);
  else writeJson(userId, key, next);
  return next;
}

export function subscribe(cb) {
  const unsubEvidence = subscribeToCloudStore(key, cb);
  const unsubRatings = questionRatings.subscribe(cb);
  return () => { unsubEvidence(); unsubRatings(); };
}
