import { dedupeConcepts, flattenWeakConcepts, rankConcepts } from "../tracker/weakConcepts.js";

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
export function weakConceptsForLectureView(store, { blockId = null, lectureId = null, objectives = [] } = {}) {
  if (!lectureId) return [];
  const objectiveIds = new Set((objectives || []).map((objective) => String(objective?.id || objective?.code || "")).filter(Boolean));
  return rankConcepts(dedupeConcepts(flattenWeakConcepts(store, { blockId })))
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
}

export function objectivesForWeakConcept(concept, objectives = []) {
  const ids = new Set(concept?.objectiveIds || []);
  return (objectives || []).filter((objective) => ids.has(String(objective?.id || objective?.code || "")));
}
