// How many times a lecture has been reviewed with questions. A review is a
// calendar day on which the learner answered enough questions on that
// lecture's objectives (independent attempts only; assisted answers do not
// count). Several sittings on one day are one review: spacing, not volume, is
// what makes repeated retrieval stick.
//
// Target: 4 spaced reviews before the exam (first pass plus three returns,
// e.g. day 1, ~day 3, ~day 7, ~day 14), the usual minimum for durable recall
// with expanding retrieval practice.

export const REVIEW_TARGET = 4;
export const MIN_ANSWERS_PER_REVIEW = 5;

const dayKey = at => {
  const date = new Date(at);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

/**
 * `{ [lectureId]: { reviews, days, lastReview } }` from the learner's
 * independent answer journal. `objectiveLecture` maps objective id to its
 * lecture for events without a lecture id; `objectiveCounts` lowers the
 * per-day threshold for lectures with fewer than five objectives.
 */
export function lectureReviewDays(journal = [], { objectiveLecture = {}, objectiveCounts = {} } = {}) {
  const perDay = new Map();
  for (const event of journal || []) {
    if (!Number.isFinite(event?.at) || event.at <= 0) continue;
    const lectures = new Set();
    if (event.lectureId) lectures.add(event.lectureId);
    else for (const id of event.objectiveIds || []) if (objectiveLecture[id]) lectures.add(objectiveLecture[id]);
    const day = dayKey(event.at);
    for (const lectureId of lectures) {
      const byDay = perDay.get(lectureId) || new Map();
      byDay.set(day, (byDay.get(day) || 0) + 1);
      perDay.set(lectureId, byDay);
    }
  }
  const result = {};
  for (const [lectureId, byDay] of perDay) {
    const objectives = Number(objectiveCounts[lectureId]);
    const threshold = Number.isFinite(objectives) && objectives > 0 ? Math.min(MIN_ANSWERS_PER_REVIEW, objectives) : MIN_ANSWERS_PER_REVIEW;
    const days = [...byDay].filter(([, count]) => count >= threshold).map(([day]) => day).sort();
    result[lectureId] = { reviews: days.length, days, lastReview: days.at(-1) || null };
  }
  return result;
}

/** Short label: "2/4 reviews", "✓ 5 reviews", or "" when never reviewed. */
export function reviewLabel(entry, target = REVIEW_TARGET) {
  const reviews = entry?.reviews || 0;
  if (!reviews) return "";
  return reviews >= target ? `✓ ${reviews} reviews` : `${reviews}/${target} reviews`;
}

/** Objective id → lecture id, from block objectives. */
export function objectiveLectureMap(objectives = []) {
  const map = {};
  for (const objective of objectives || []) if (objective?.id && objective.linkedLecId) map[objective.id] = objective.linkedLecId;
  return map;
}
