import { readCloud, writeCloud, subscribeToCloudStore, isHydrated } from "./cloudBase.js";
import { readJson, writeJson } from "./base.js";

// Question bodies live per lecture, not in the all-lectures progress document.
// Review status remains exclusively in atomProgress.
export function repairEvidenceStore(lectureId) {
  const key = `rxt-model-repair-${lectureId}`;
  return {
    read: (userId) => userId ? readCloud(userId, key, {}) || {} : readJson(userId, key, {}) || {},
    write: (userId, value) => userId ? writeCloud(userId, key, value, { merge: true }) : writeJson(userId, key, value),
    subscribe: (cb) => subscribeToCloudStore(key, cb),
    isHydrated: (userId) => !userId || isHydrated(userId, key),
  };
}

export function saveRepairEvidence(userId, lectureId, atomKey, question) {
  const store = repairEvidenceStore(lectureId);
  const current = store.read(userId);
  const next = { ...current, [atomKey]: {
    concept: String(question.topic || atomKey).slice(0, 200),
    stem: String(question.stem || "").slice(0, 6000),
    choices: Object.fromEntries(Object.entries(question.choices || {}).slice(0, 8).map(([k, v]) => [k, String(v).slice(0, 1500)])),
    picked: question.picked || null, correct: question.correct || null,
    explanation: String(question.explanation || "").slice(0, 6000),
    confidence: question.confidence || null, at: Date.now(),
  } };
  // Retain recent evidence within a conservative Firestore document budget.
  const retained = {};
  let bytes = 0;
  for (const [key, value] of Object.entries(next).sort((a, b) => b[1].at - a[1].at)) {
    bytes += new TextEncoder().encode(JSON.stringify({ [key]: value })).length;
    if (bytes > 600000) break;
    retained[key] = value;
  }
  store.write(userId, retained);
}
