import { buildStyleFingerprint, exemplarSourceTier } from "./mcq.js";

export const STYLE_PROFILE_VERSION = 2;

const broadOutcome = /^(?:school of medicine|basic sciences|content outline\s*\/\s*systems|physician tasks\s*\/\s*competencies|disciplines|medical knowledge: applying foundational science concepts|basic principles of medicine.*)$/i;

function reportOutcomePerformance(questions) {
  const outcomes = new Map();
  for (const question of questions) {
    if (typeof question?.sourceAttemptCorrect !== "boolean") continue;
    const labels = Array.isArray(question.schoolLearningOutcomeTags)
      ? question.schoolLearningOutcomeTags
      : String(question.schoolLearningOutcomes || "").split(/\s*·\s*/);
    for (const labelValue of labels) {
      const label = String(labelValue || "").replace(/\s+/g, " ").trim();
      if (!label || broadOutcome.test(label)) continue;
      const entry = outcomes.get(label) || { label, attempts: 0, correct: 0 };
      entry.attempts += 1;
      entry.correct += question.sourceAttemptCorrect ? 1 : 0;
      outcomes.set(label, entry);
    }
  }
  return [...outcomes.values()].map((entry) => ({
    ...entry,
    accuracy: Math.round(entry.correct / entry.attempts * 100),
  })).sort((a, b) => a.accuracy - b.accuracy || b.attempts - a.attempts || a.label.localeCompare(b.label));
}

/** Build a compact, cumulative style profile from every verified upload. */
export function buildStyleProfile(examples = [], { now = Date.now() } = {}) {
  const usable = (examples || []).filter((question) =>
    question?.stem && question?.choices && question.answerKeyVerified !== false
  );
  const official = usable.filter((question) => {
    const tier = exemplarSourceTier(question);
    return tier !== "homework" && tier !== "clicker";
  });
  const sourceCounts = {};
  const optionCounts = {};
  for (const question of usable) {
    const source = exemplarSourceTier(question);
    sourceCounts[source] = (sourceCounts[source] || 0) + 1;
    const count = Object.keys(question.choices || {}).length;
    optionCounts[count] = (optionCounts[count] || 0) + 1;
  }
  return {
    version: STYLE_PROFILE_VERSION,
    sampleSize: usable.length,
    sourceCounts,
    optionCounts,
    officialStyle: buildStyleFingerprint(official),
    homeworkStyle: buildStyleFingerprint(usable.filter((q) => exemplarSourceTier(q) === "homework")),
    clickerStyle: buildStyleFingerprint(usable.filter((q) => exemplarSourceTier(q) === "clicker")),
    reportOutcomePerformance: reportOutcomePerformance(usable),
    updatedAt: now,
  };
}
