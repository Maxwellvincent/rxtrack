import { getBloomLevel } from "../bloomsTaxonomy.js";

export const QUESTION_ORDER_LEVELS = ["first-order", "second-order", "third-order"];

export const QUESTION_ORDER_LABELS = {
  "first-order": "1st order · recognize",
  "second-order": "2nd order · apply a relationship",
  "third-order": "3rd order · integrate and predict",
};

export function normalizeQuestionOrder(value) {
  const text = String(value || "").trim().toLowerCase().replace(/\s+/g, "-");
  if (/^(?:1|first)(?:-?order)?$/.test(text)) return "first-order";
  if (/^(?:2|second)(?:-?order)?$/.test(text)) return "second-order";
  if (/^(?:3|third)(?:-?order)?$/.test(text)) return "third-order";
  return QUESTION_ORDER_LEVELS.includes(text) ? text : null;
}

export function objectiveBloomLevel(objective = {}) {
  const stored = Number(objective?.bloom_level);
  if (Number.isFinite(stored) && stored >= 1 && stored <= 6) return Math.round(stored);
  return getBloomLevel(objective?.objective || objective?.text || objective?.content || "").level;
}

/**
 * Bloom is a ceiling and a guide, not a claim that an objective is mastered.
 * A low-level objective can still get an application item, but a third-order
 * item should only be requested when the objective or its supplied facts can
 * support integration.
 */
export function objectiveOrderProfile(objective = {}) {
  const bloomLevel = objectiveBloomLevel(objective);
  if (bloomLevel <= 1) return { bloomLevel, primary: "first-order", allowed: ["first-order", "second-order"] };
  if (bloomLevel === 2) return { bloomLevel, primary: "second-order", allowed: ["first-order", "second-order"] };
  if (bloomLevel === 3) return { bloomLevel, primary: "second-order", allowed: ["first-order", "second-order", "third-order"] };
  return { bloomLevel, primary: "third-order", allowed: ["second-order", "third-order"] };
}

export function questionOrderDescription(level) {
  return {
    "first-order": "recognize or identify one supplied fact",
    "second-order": "use one supplied relationship to explain or predict a finding",
    "third-order": "integrate at least two supplied relationships, then predict, compare, or choose the downstream result",
  }[normalizeQuestionOrder(level)] || "apply the supplied objective and lecture evidence";
}

/** Create a transparent target mix for both lecture quizzes and Exam-style sets. */
export function buildOrderBlueprint({ objectives = [], count = 10 } = {}) {
  const total = Math.max(1, Number(count) || 1);
  const profiles = (objectives || []).map((objective) => ({
    id: objective?.id || objective?.code || null,
    text: objective?.objective || objective?.text || "",
    ...objectiveOrderProfile(objective),
  }));
  const hasHighOrderObjective = profiles.some((profile) => profile.bloomLevel >= 3);
  const hasThirdOrderObjective = profiles.some((profile) => profile.allowed.includes("third-order"));
  const first = total <= 3 ? 1 : Math.max(1, Math.round(total * 0.2));
  // Keep the target mix bounded for tiny quizzes: a one-question quiz cannot
  // simultaneously contain both its first- and third-order target.
  const third = hasThirdOrderObjective
    ? Math.min(Math.max(0, total - first), Math.max(1, Math.round(total * 0.2)))
    : 0;
  const second = Math.max(0, total - first - third);
  return {
    targets: { "first-order": first, "second-order": second, "third-order": third },
    objectiveTargets: profiles,
    rationale: hasHighOrderObjective
      ? "Use first-order items to establish the facts, second-order items to apply relationships, and third-order items only where the supplied objectives/facts support integration."
      : "Use first-order items to establish the facts and second-order items to apply the supplied relationships; do not manufacture third-order complexity from a low-level objective.",
    hasThirdOrderObjective,
  };
}

/** Best-effort structural classification used for analytics and display, not medical validation. */
export function classifyQuestionOrder(question = {}, objective = null) {
  const explicit = normalizeQuestionOrder(question?.orderLevel || question?.questionOrder);
  if (explicit) return explicit;
  const stem = String(question?.stem || "").replace(/\s+/g, " ").trim();
  const task = String(question?.taskType || "").toLowerCase();
  const sentences = stem.split(/[.!?]+/).filter(Boolean).length;
  const hasIntegration = /\b(after|because|therefore|consequently|downstream|if .*blocked|in addition|combined with|both .* and|which change would result|what would be expected next)\b/i.test(stem);
  const hasRelationship = /\b(mechanism|explain|expected|predict|relationship|compare|contrast|differentiate|next step|would occur|result in|leads to)\b/i.test(stem);
  const profile = objectiveOrderProfile(objective || {});
  if (hasIntegration && sentences >= 3 && profile.allowed.includes("third-order")) return "third-order";
  if (["clinical-application", "fresh-retest", "mechanism", "prediction", "relationship", "decision"].includes(task) || hasRelationship) {
    return "second-order";
  }
  return "first-order";
}

export function stampQuestionOrders(questions = [], objectives = []) {
  const byId = new Map((objectives || []).map((objective) => [String(objective.id || objective.code || ""), objective]));
  return (questions || []).map((question) => {
    const objective = (question?.objectiveIds || []).map((id) => byId.get(String(id))).find(Boolean) || (objectives.length === 1 ? objectives[0] : null);
    const profile = objectiveOrderProfile(objective || {});
    const classified = classifyQuestionOrder(question, objective);
    const orderLevel = profile.allowed.includes(classified) ? classified : profile.primary;
    return { ...question, orderLevel, bloomLevel: profile.bloomLevel };
  });
}
