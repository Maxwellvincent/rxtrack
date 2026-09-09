import { readCloud, writeCloud } from "./cloudBase.js";

export const key = "rxt-question-ratings-v1";
const empty = { ratings: {} };

function idFor(question) {
  const value = String(question?.id || question?.questionId || question?.stem || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) { hash ^= value.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  return `rating_${(hash >>> 0).toString(36)}`;
}

export function read(userId) {
  return readCloud(userId, key, empty) || empty;
}

export function ratingFor(userId, question) {
  return read(userId).ratings?.[idFor(question)] || null;
}

export function rateQuestion(userId, question, patch) {
  if (!userId || !question?.generationVersion) return null;
  const current = read(userId);
  const id = idFor(question);
  const nextRating = {
    ...(current.ratings?.[id] || {}),
    ...patch,
    questionId: question.id || question.questionId || null,
    generationVersion: question.generationVersion,
    lectureId: question.lectureId || null,
    updatedAt: new Date().toISOString(),
  };
  writeCloud(userId, key, { ...current, ratings: { ...(current.ratings || {}), [id]: nextRating } });
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
