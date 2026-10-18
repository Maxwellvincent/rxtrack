import { questionIdentityValues, evidenceIdentity, questionIsExcluded, reportProtection } from "../engine/questionScoringPolicy.js";
import { readCloud, subscribeToCloudStore, writeCloud, writeCloudAwait } from "./cloudBase.js";

export const key = "rxt-question-ratings-v1";
import { readJson, writeJson } from "./base.js";

const empty = { ratings: {} };

function idFor(question) {
  const value = String(question?.questionKey || question?.poolId || (question?.sourceFile ? `${question.sourceFile}:${question.id || question.questionId || question.stem}` : question?.id || question?.questionId || question?.stem) || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) { hash ^= value.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  return `rating_${(hash >>> 0).toString(36)}`;
}

export function read(userId) {
  return (userId ? readCloud(userId, key, empty) : readJson(userId, key, empty)) || empty;
}

function storedRatingId(ratings, question) {
  const primary = idFor(question);
  if (ratings[primary]) return primary;
  const identities = new Set(questionIdentityValues(question).map(evidenceIdentity));
  return Object.keys(ratings).find(id => ratings[id].evidenceKey && identities.has(evidenceIdentity(ratings[id].evidenceKey))) || primary;
}
export function ratingFor(userId, question) {
  const ratings = read(userId).ratings || {};
  return ratings[storedRatingId(ratings, question)] || null;
}

export function rateQuestion(userId, question, patch, { persistAwait = false } = {}) {
  if (!question?.generationVersion && !("sourceIssue" in patch) && !("excludeFromPerformance" in patch) && !("excludeFromObjectives" in patch) && !("sourceNote" in patch)) return null;
  if (!question?.id && !question?.questionId && !question?.stem) return null;
  const current = read(userId);
  const id = idFor(question);
  const previousId = storedRatingId(current.ratings || {}, question);
  const nextRating = {
    ...(current.ratings?.[previousId] || {}),
    ...patch,
    questionId: question.questionId || ((!question.sourceFile || !question.questionKey) ? question.id : null) || null,
    generationVersion: question.generationVersion || null,
    evidenceKey: question.questionKey || question.poolId || question.id || question.questionId || `stem:${question.stem || ""}`,
    evidenceAliases: questionIdentityValues(question),
    lectureId: question.lectureId || null,
    updatedAt: new Date().toISOString(),
  };
  const nextRatings = { ...(current.ratings || {}) };
  if (previousId !== id) delete nextRatings[previousId];
  const next = { ...current, ratings: { ...nextRatings, [id]: nextRating } };
  if (userId && persistAwait) return writeCloudAwait(userId, key, next).then(() => nextRating);
  if (userId) writeCloud(userId, key, next);
  else writeJson(userId, key, next);
  return nextRating;
}

export function comparison(userId) {
  const groups = { v1: [], v2: [] };
  for (const rating of Object.values(read(userId).ratings || {})) {
    if (groups[rating.generationVersion] && rating.fair != null && rating.examStyle != null) groups[rating.generationVersion].push(rating);
  }
  return Object.fromEntries(Object.entries(groups).map(([version, ratings]) => [version, {
    count: ratings.length,
    fairPercent: ratings.length ? Math.round(100 * ratings.filter((r) => r.fair).length / ratings.length) : null,
    examStylePercent: ratings.length ? Math.round(100 * ratings.filter((r) => r.examStyle).length / ratings.length) : null,
    issuePercent: ratings.length ? Math.round(100 * ratings.filter((r) => r.issue).length / ratings.length) : null,
  }]));
}

/** Compact, prompt-safe feedback summary used to prevent recurring generation mistakes. */
export function feedbackFor(userId, lectureId = null, generationVersion = null) {
  const ratings = Object.values(read(userId).ratings || {}).filter((rating) =>
    (!lectureId || rating.lectureId === lectureId) && (!generationVersion || rating.generationVersion === generationVersion)
  );
  const issueCounts = {};
  for (const rating of ratings) {
    for (const issue of [rating.issue, rating.sourceIssue].filter(Boolean)) issueCounts[issue] = (issueCounts[issue] || 0) + 1;
  }
  return {
    sampleSize: ratings.length,
    fairNo: ratings.filter((r) => r.fair === false).length,
    examStyleNo: ratings.filter((r) => r.examStyle === false).length,
    issueCounts: Object.fromEntries(Object.entries(issueCounts).sort((a, b) => b[1] - a[1]).slice(0, 8)),
  };
}

export function subscribe(cb) { return subscribeToCloudStore(key, cb); }

export function isExcluded(userId, question, scope = "performance") {
  return questionIsExcluded(question, read(userId).ratings, scope);
}
export function isDiagnosticExcluded(userId, diagnosticKey) {
  return Object.values(read(userId).ratings || {}).some(rating => reportProtection(rating).performance &&
    [rating.questionId, ...(rating.evidenceAliases || [])].some(value => value && String(diagnosticKey).endsWith(`:${value}`)));
}
export { evidenceIdentity };

export async function rateQuestionAwait(userId, question, patch) {
  return rateQuestion(userId, question, patch, { persistAwait: true });
}
