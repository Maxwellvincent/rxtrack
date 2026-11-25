import { objectivePracticePlan } from "../../../engine/objectivePractice.js";

/**
 * Rough exam estimate: each objective's smoothed independent accuracy
 * ((correct + 1) / (attempts + 2), so an unanswered objective counts as 50%),
 * weighted by how often school questions test it (1 + emphasis count).
 * Not a calibrated prediction — it says where the score is likely to come from.
 */
export function projectedScore(objectives = [], evidence = {}, { target = 0.8 } = {}) {
  const rows = objectivePracticePlan(objectives, evidence).rows;
  if (!rows.length) return null;
  const byId = new Map(objectives.map((objective) => [objective.id, objective]));
  let weighted = 0, total = 0, answered = 0;
  const items = rows.map((row) => {
    const objective = byId.get(row.id) || {};
    const weight = 1 + (Number(objective._schoolEmphasis) || 0);
    const p = (row.correct + 1) / (row.attempts + 2);
    weighted += weight * p; total += weight;
    if (row.attempts > 0) answered += 1;
    return { id: row.id, text: row.text, lectureId: objective.linkedLecId || null, weight, p, attempts: row.attempts, gain: weight * Math.max(0, target - p) };
  });
  const score = weighted / total;
  return {
    score,
    target,
    coverage: answered / rows.length,
    objectives: rows.length,
    answered,
    // Biggest expected gain from bringing an objective up to target.
    topGains: items.filter((item) => item.gain > 0).sort((a, b) => b.gain - a.gain).slice(0, 5),
  };
}
