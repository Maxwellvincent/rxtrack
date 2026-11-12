import {isIndependentAttempt} from '../../../engine/practiceAssistance.js';
import { objectivePracticePlan } from "../../../engine/objectivePractice.js";

/** Combine lecture-level practice totals with linked-objective exposure. */
export function buildWeakAreaMap({ lectures = [], objectives = [], questionStats = {}, learnerEvidence = {}, reportWeaknesses = [] } = {}) {
  const byLecture = new Map();
  const assistedLectures=new Set((learnerEvidence.assistedJournal || learnerEvidence.evidenceJournal || []).filter(event=>!isIndependentAttempt(event)).map(event=>event.lectureId));
  const practice = new Map(objectivePracticePlan(objectives, learnerEvidence).rows.map(row=>[row.id,row]));
  for (const objective of objectives || []) {
    const lectureId = objective?.linkedLecId || objective?.lectureId;
    if (!lectureId) continue;
    const id = objective.id || objective.code;
    const row = byLecture.get(lectureId) || { total: 0, tested: 0, struggling: 0 };
    row.total += 1;
    if (practice.get(id)?.worked) row.tested += 1;
    if (practice.get(id)?.state === "struggling") row.struggling += 1;
    byLecture.set(lectureId, row);
  }

  return (lectures || []).filter((lecture) => lecture?.id).map((lecture) => {
    const objective = byLecture.get(lecture.id) || { total: 0, tested: 0, struggling: 0 };
    const totalQuestions = Math.max(0, Number(questionStats?.[lecture.id]?.answered) || 0);
    const correct = Math.min(totalQuestions, Math.max(0, Number(questionStats?.[lecture.id]?.correct) || 0));
    const accuracy = totalQuestions ? correct / totalQuestions : null;
    const detailed=questionStats?.[lecture.id]?.recentAnswers||[];
    const useDetailed=detailed.length>=3&&detailed.at(-1).at>=(learnerEvidence?.lectures?.[lecture.id]?.lastSeen||0)-1000;
    const recent = useDetailed?detailed.map(a=>a.correct):learnerEvidence?.lectures?.[lecture.id]?.recent || [];
    const recentAccuracy = recent.length ? recent.filter(Boolean).length / recent.length : null;
    const hasAssistedAnswers=questionStats?.[lecture.id]?.hasAssistedAnswers===true || assistedLectures.has(lecture.id);
    const independent=learnerEvidence?.lectures?.[lecture.id];
    const independentAccuracy=independent?.attempts?independent.correct/independent.attempts:null;
    const priorityAccuracy = recent.length >= 3 ? recentAccuracy : hasAssistedAnswers?independentAccuracy:accuracy;
    const reportTopics = [...new Set((reportWeaknesses || []).filter(entry =>
      entry?.tags?.includes("exam-report") && entry.masteryLevel === "struggling" && entry.linkedLecIds?.includes(lecture.id)
    ).map(entry => entry.concept).filter(Boolean))];
    return {
      hasAssistedAnswers, recentCount: recent.length, recentAccuracy, priorityAccuracy, reportTopics,
      objectiveLinksMissing: totalQuestions > 0 && objective.total > 0 && objective.tested === 0,
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
  }).sort((a, b) => {
    const rank = row => row.priorityAccuracy != null && row.priorityAccuracy < 0.8 ? 0
      : row.reportTopics.length ? 1 : row.strugglingObjectives ? 2 : row.objectivesUntested ? 3 : 4;
    return rank(a) - rank(b)
      || (a.priorityAccuracy ?? 2) - (b.priorityAccuracy ?? 2)
      || b.misses - a.misses || b.objectivesUntested - a.objectivesUntested
      || String(a.lecture.lectureTitle || a.lecture.fileName || "").localeCompare(String(b.lecture.lectureTitle || b.lecture.fileName || ""));
  });
}
