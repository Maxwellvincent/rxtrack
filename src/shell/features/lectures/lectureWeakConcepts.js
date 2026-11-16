import { dedupeConcepts, flattenWeakConcepts, rankConcepts } from "../tracker/weakConcepts.js";
import { reconcileWeakConceptRecovery } from "../../../engine/weakConceptRecovery.js";
import {conceptName,conceptKey} from '../../../engine/conceptIdentity.js';

const timeOf = (value) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : 0;
};

function conceptObjectiveIds(concept = {}) {
  return [...new Set([
    ...(Array.isArray(concept.objectiveIds) ? concept.objectiveIds : []),
    concept.linkedObjId,
    typeof concept.fromObjective === "string" ? concept.fromObjective : null,
  ].filter(Boolean).map(String))];
}

/** Weak-concept rows owned by one lecture, with honest cumulative and latest-result metadata. */
export function weakConceptsForLectureView(store, { blockId = null, lectureId = null, objectives = [], evidence = [] } = {}) {
  if (!lectureId) return [];
  const objectiveIds = new Set((objectives || []).map((objective) => String(objective?.id || objective?.code || "")).filter(Boolean));
  const rows = rankConcepts(dedupeConcepts(flattenWeakConcepts(reconcileWeakConceptRecovery(store, evidence), { blockId })))
    .filter((concept) => concept?.masteryLevel !== "mastered" && (concept?.linkedLecIds || []).includes(lectureId))
    .map((concept) => {
      const linkedObjectiveIds = conceptObjectiveIds(concept).filter((id) => objectiveIds.has(id));
      const missedAt = timeOf(concept.lastMissed);
      const correctAt = timeOf(concept.lastCorrect);
      const attempts = Math.max(Number(concept.totalAttempts) || 0, Number(concept.missCount) || 0);
      const misses = Math.min(attempts, Math.max(0, Number(concept.missCount) || 0));
      return {
        ...concept,
        objectiveIds: linkedObjectiveIds,
        attempts,
        misses,
        correct: Math.max(0, attempts - misses),
        lastOutcome: !missedAt && !correctAt ? null : correctAt >= missedAt ? "correct" : "missed",
        lastAt: Math.max(missedAt, correctAt) || null,
      };
    });
  const groups = new Map();
  for (const row of rows) {
    const key = conceptKey(row.concept || row.description);
    const previous = groups.get(key);
    if (!previous) { groups.set(key,{...row,concept:conceptName(row.concept || row.description)}); continue; }
    groups.set(key,{...previous,objectiveIds:[...new Set([...previous.objectiveIds,...row.objectiveIds])],misses:previous.misses+row.misses,correct:previous.correct+row.correct,attempts:previous.attempts+row.attempts,consecutiveCorrect:Math.min(previous.consecutiveCorrect||0,row.consecutiveCorrect||0),...(row.lastAt>previous.lastAt?{lastAt:row.lastAt,lastOutcome:row.lastOutcome}:{})});
  }
  return [...groups.values()];
}

export function objectivesForWeakConcept(concept, objectives = []) {
  const ids = new Set(concept?.objectiveIds || []);
  return (objectives || []).filter((objective) => ids.has(String(objective?.id || objective?.code || "")));
}
