import { levelFromConsecutive } from "./mastery.js";

const evidenceId = (event) => String(event?.eventId || event?.questionKey || "").trim();
const questionId = (event) => String(event?.questionKey || event?.eventId || "").trim();

function matchesConcept(concept, event) {
  if (!concept || !event) return false;
  if (concept.blockId && event.blockId && concept.blockId !== event.blockId) return false;

  const conceptObjectives = new Set((concept.objectiveIds || []).map(String));
  if (conceptObjectives.size) {
    return (event.objectiveIds || []).some((id) => conceptObjectives.has(String(id)));
  }

  const conceptLectures = new Set((concept.linkedLecIds || []).map(String));
  return !!event.lectureId && conceptLectures.has(String(event.lectureId));
}

function freshHistory(events) {
  const byEvent = new Map();
  for (const event of events || []) {
    const id = evidenceId(event);
    const questionKey = questionId(event);
    if (!id || !questionKey || event?.assisted || event?.assistance?.used) continue;
    byEvent.set(id, {
      eventId: id,
      questionKey,
      correct: event.correct === true,
      at: Number(event.at) || 0,
      sessionKey: event.sessionKey || null,
    });
  }

  const byQuestion = new Map();
  for (const event of [...byEvent.values()].sort((a, b) => a.at - b.at)) {
    if (!byQuestion.has(event.questionKey)) byQuestion.set(event.questionKey, event);
  }
  return [...byQuestion.values()].sort((a, b) => a.at - b.at).slice(-20);
}

function sameRecovery(a, b) {
  return JSON.stringify(a || []) === JSON.stringify(b || []);
}

function reconcileConcept(concept, evidence) {
  const recoveryStartedAt = Number(concept.recoveryStartedAt) || Date.parse(concept?.lastMissed || concept?.dateFirstSeen || "") || 0;
  const matched = (evidence || []).filter((event) =>
    matchesConcept(concept, event) && (Number(event?.at) || 0) > recoveryStartedAt
  );
  if (!matched.length) return concept;
  const recoveryEvidence = freshHistory(matched);
  if (!recoveryEvidence.length) return concept;

  let consecutiveCorrect = 0;
  for (const event of recoveryEvidence) consecutiveCorrect = event.correct ? consecutiveCorrect + 1 : 0;
  const masteryLevel = levelFromConsecutive(consecutiveCorrect);
  const latestCorrect = [...recoveryEvidence].reverse().find((event) => event.correct);
  const latestWrong = [...recoveryEvidence].reverse().find((event) => !event.correct);
  const next = {
    ...concept,
    recoveryStartedAt,
    recoveryEvidence,
    recoveryEvidenceVersion: 1,
    consecutiveCorrect,
    masteryLevel,
    totalAttempts: Math.max(Number(concept.totalAttempts) || 0, recoveryEvidence.length),
    ...(latestCorrect?.at ? { lastCorrect: new Date(latestCorrect.at).toISOString() } : {}),
    ...(latestWrong?.at ? { lastMissed: new Date(latestWrong.at).toISOString() } : {}),
  };
  if (concept.consecutiveCorrect === next.consecutiveCorrect
    && concept.masteryLevel === next.masteryLevel
    && concept.totalAttempts === next.totalAttempts
    && concept.lastCorrect === next.lastCorrect
    && concept.lastMissed === next.lastMissed
    && concept.recoveryEvidenceVersion === 1
    && sameRecovery(concept.recoveryEvidence, recoveryEvidence)) return concept;
  return next;
}

/**
 * Recompute weak-concept recovery from the authoritative, independently
 * answered evidence journal. Objective links take precedence; lecture-level
 * matching is used only for older records with no objective mapping.
 */
export function reconcileWeakConceptRecovery(store, evidence = []) {
  if (!store || typeof store !== "object" || !evidence.length) return store || {};
  let changed = false;
  const next = {};
  for (const [bucket, value] of Object.entries(store)) {
    if (!Array.isArray(value)) {
      next[bucket] = value;
      continue;
    }
    const reconciled = value.map((concept) => {
      const updated = reconcileConcept(concept, evidence);
      if (updated !== concept) changed = true;
      return updated;
    });
    next[bucket] = reconciled;
  }
  return changed ? next : store;
}

