const TESTED_STATUSES = new Set(["mastered", "developing", "inprogress", "struggling"]);

/** Combine lecture-level practice totals with linked-objective exposure. */
export function buildWeakAreaMap({ lectures = [], objectives = [], questionStats = {}, learnerEvidence = {} } = {}) {
  const byLecture = new Map();
  for (const objective of objectives || []) {
    const lectureId = objective?.linkedLecId || objective?.lectureId;
    if (!lectureId) continue;
    const id = objective.id || objective.code;
    const evidence = id ? learnerEvidence?.objectives?.[id] : null;
    const status = String(objective.status || "untested").toLowerCase();
    const row = byLecture.get(lectureId) || { total: 0, tested: 0, struggling: 0 };
    row.total += 1;
    if (Number(evidence?.attempts) > 0 || TESTED_STATUSES.has(status)) row.tested += 1;
    if (status === "struggling" || (Number(evidence?.attempts) > 0 && evidence?.recent?.at(-1) === false)) row.struggling += 1;
    byLecture.set(lectureId, row);
  }

  return (lectures || []).filter((lecture) => lecture?.id).map((lecture) => {
    const objective = byLecture.get(lecture.id) || { total: 0, tested: 0, struggling: 0 };
    const totalQuestions = Math.max(0, Number(questionStats?.[lecture.id]?.answered) || 0);
    const correct = Math.min(totalQuestions, Math.max(0, Number(questionStats?.[lecture.id]?.correct) || 0));
    const accuracy = totalQuestions ? correct / totalQuestions : null;
    return {
      lectureId: lecture.id,
      lecture,
      totalQuestions,
      correct,
      misses: totalQuestions - correct,
      accuracy,
      objectiveTotal: objective.total,
      objectivesTested: objective.tested,
      objectivesUntested: Math.max(0, objective.total - objective.tested),
      strugglingObjectives: objective.struggling,
    };
  }).sort((a, b) => b.objectivesUntested - a.objectivesUntested
    || (a.accuracy ?? 2) - (b.accuracy ?? 2)
    || b.misses - a.misses
    || String(a.lecture.lectureTitle || a.lecture.fileName || "").localeCompare(String(b.lecture.lectureTitle || b.lecture.fileName || "")));
}
