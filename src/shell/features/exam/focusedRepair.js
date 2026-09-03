import { flattenWeakConcepts } from "../tracker/weakConcepts.js";
import { SCHOOL_EXAM_TARGET_RATE } from "../../logic/performanceTargets.js";

export const REPAIR_TASK_CYCLE = ["recognition", "mechanism", "clinical-application", "fresh-retest"];
export const REPAIR_MIN_FRESH_ANSWERS = 5;

const statusOf = (objective) => String(objective?.status || "untested").toLowerCase();

export function objectiveRepairEvidence(evidence) {
  const recent = (evidence?.recent || []).slice(-REPAIR_MIN_FRESH_ANSWERS);
  const accuracy = recent.length ? recent.filter(Boolean).length / recent.length : null;
  return {
    recentCount: recent.length,
    recentAccuracy: accuracy,
    cleared: recent.length >= REPAIR_MIN_FRESH_ANSWERS && accuracy >= SCHOOL_EXAM_TARGET_RATE,
  };
}

/** Build an objective-first repair scope without mutating the ordinary exam blueprint. */
export function buildFocusedRepairScope({ eligibleLectures = [], objectivesByLecture = {}, weakConcepts = {}, learnerEvidence = {}, blockId } = {}) {
  const weak = flattenWeakConcepts(weakConcepts, { blockId });
  const weakLectureIds = new Set(weak.flatMap((item) => item?.linkedLecIds || []));
  const weakObjectiveIds = new Set(weak.flatMap((item) => item?.objectiveIds || []));
  const scored = eligibleLectures.map((lecture) => {
    const objectives = [...(objectivesByLecture[lecture.lectureId] || [])].map((objective) => {
      const id = objective?.id || objective?.code;
      const evidence = objectiveRepairEvidence(learnerEvidence?.objectives?.[id]);
      const status = statusOf(objective);
      const explicitlyWeak = weakObjectiveIds.has(id) || status === "struggling";
      const lectureWeak = weakLectureIds.has(lecture.lectureId);
      const accuracy = evidence.recentAccuracy ?? (learnerEvidence?.objectives?.[id]?.attempts
        ? learnerEvidence.objectives[id].correct / learnerEvidence.objectives[id].attempts : null);
      const priority = (explicitlyWeak ? 12 : 0) + (lectureWeak ? 6 : 0)
        + (status === "inprogress" || status === "developing" ? 4 : 0)
        + (status === "untested" ? 2 : 0)
        + (accuracy != null && accuracy < SCHOOL_EXAM_TARGET_RATE ? (SCHOOL_EXAM_TARGET_RATE - accuracy) * 10 : 0);
      return { ...objective, repairPriority: evidence.cleared ? 0 : priority, repairEvidence: evidence };
    }).filter((objective) => objective.repairPriority > 0)
      .sort((a, b) => b.repairPriority - a.repairPriority);
    return { lecture, objectives, score: objectives.reduce((sum, objective) => sum + objective.repairPriority, 0) };
  }).filter((row) => row.objectives.length)
    .sort((a, b) => b.score - a.score || String(a.lecture.lectureLabel || a.lecture.lectureId || "").localeCompare(String(b.lecture.lectureLabel || b.lecture.lectureId || "")));

  return {
    eligibleLectures: scored.map(({ lecture, objectives, score }) => ({ ...lecture, objectiveCount: objectives.length, repairPriority: score })),
    objectivesByLecture: Object.fromEntries(scored.map(({ lecture, objectives }) => [lecture.lectureId, objectives])),
    objectiveCount: scored.reduce((sum, row) => sum + row.objectives.length, 0),
  };
}

export function repairTaskForIndex(index) {
  return REPAIR_TASK_CYCLE[Math.abs(Number(index) || 0) % REPAIR_TASK_CYCLE.length];
}
