import { confidenceAnalytics } from "../exam/confidenceAnalytics.js";
import { blockPracticeSummary } from "./blockPractice.js";

const objectiveStatus = (objective) => {
  const status = String(objective?.status || "untested").toLowerCase();
  if (status === "developing") return "inprogress";
  return ["mastered", "inprogress", "struggling"].includes(status) ? status : "untested";
};

const accuracyOf = (row) => {
  const answered = Math.max(0, Number(row?.answered) || 0);
  const correct = Math.max(0, Number(row?.correct) || 0);
  return answered ? Math.min(1, correct / answered) : null;
};

export function readinessTrend(records = []) {
  const valid = records.filter((row) => typeof row?.correct === "boolean");
  const recent = valid.slice(-20);
  const prior = valid.slice(-40, -20);
  if (recent.length < 5 || prior.length < 5) return { direction: "baseline", delta: null, label: "Building baseline" };
  const rate = (rows) => rows.filter((row) => row.correct).length / rows.length;
  const delta = rate(recent) - rate(prior);
  if (delta >= 0.05) return { direction: "up", delta, label: "Improving" };
  if (delta <= -0.05) return { direction: "down", delta, label: "Needs attention" };
  return { direction: "steady", delta, label: "Holding steady" };
}

export function blockReadinessSummary({
  blockId,
  lectures = [],
  objectives = [],
  questionStats = {},
  sessions = [],
  confidenceRecords = [],
  models = [],
  weakConcepts = [],
  now = Date.now(),
}) {
  const blockLectures = lectures.filter((lecture) => lecture?.blockId === blockId);
  const lecturesById = Object.fromEntries(blockLectures.map((lecture) => [lecture.id, lecture]));
  const practice = blockPracticeSummary(blockId, blockLectures, questionStats, sessions);
  const statuses = { mastered: 0, inprogress: 0, struggling: 0, untested: 0 };
  objectives.forEach((objective) => { statuses[objectiveStatus(objective)] += 1; });
  const totalObjectives = objectives.length;
  const coveredObjectives = totalObjectives - statuses.untested;
  const confidence = confidenceAnalytics(confidenceRecords);
  const blockModels = models.filter((model) => model?.blockId === blockId);
  const activeModels = blockModels.filter((model) => !["Released"].includes(model.status));
  const overdueModels = activeModels.filter((model) => Number.isFinite(model.nextReviewAt) && model.nextReviewAt <= now);
  const weakLectureIds = new Set((weakConcepts || []).flatMap((entry) => entry?.linkedLecIds || []).filter(Boolean));

  const targets = blockLectures.map((lecture) => {
    const linked = objectives.filter((objective) => objective?.linkedLecId === lecture.id);
    const counts = { mastered: 0, inprogress: 0, struggling: 0, untested: 0 };
    linked.forEach((objective) => { counts[objectiveStatus(objective)] += 1; });
    const accuracy = accuracyOf(questionStats[lecture.id]);
    const modelOverdue = overdueModels.some((model) => model.lectureId === lecture.id);
    const weakFlag = weakLectureIds.has(lecture.id);
    const score = counts.struggling * 6 + counts.inprogress * 2 + Math.min(4, counts.untested * 0.25)
      + (accuracy != null && accuracy < 0.74 ? (0.74 - accuracy) * 12 : 0)
      + (weakFlag ? 4 : 0) + (modelOverdue ? 2 : 0);
    const reasons = [];
    if (counts.struggling) reasons.push(`${counts.struggling} struggling objective${counts.struggling === 1 ? "" : "s"}`);
    if (accuracy != null && accuracy < 0.74) reasons.push(`${Math.round(accuracy * 100)}% practice accuracy`);
    if (weakFlag) reasons.push("flagged by exam review");
    if (modelOverdue) reasons.push("model retrieval due");
    if (!reasons.length && counts.untested) reasons.push(`${counts.untested} untested objective${counts.untested === 1 ? "" : "s"}`);
    return { lectureId: lecture.id, title: lecture.lectureTitle || lecture.fileName || "Untitled lecture", score, reasons, accuracy, ...counts };
  }).filter((target) => target.score > 0 && target.reasons.length)
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
    .slice(0, 3);

  const coverage = totalObjectives ? coveredObjectives / totalObjectives : null;
  const modelFreshness = blockModels.length ? (blockModels.length - overdueModels.length) / blockModels.length : null;
  const trend = readinessTrend(confidenceRecords);
  let state = "Building coverage";
  if (statuses.struggling > 0 || (practice.accuracy != null && practice.accuracy < 0.6)) state = "Repair first";
  else if (coverage != null && coverage >= 0.7 && practice.accuracy != null && practice.accuracy >= 0.74) state = "Progressing well";

  return {
    state,
    practice,
    confidence,
    trend,
    targets,
    objectives: { ...statuses, total: totalObjectives, covered: coveredObjectives, coverage },
    models: { total: blockModels.length, overdue: overdueModels.length, freshness: modelFreshness },
    lecturesById,
  };
}
