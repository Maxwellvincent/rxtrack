// Exam-aware spacing: review gaps shrink as the exam approaches so a lecture is
// seen several times in the final stretch and always on the day before the exam.
const DAY = 86400000;
const startOfDay = (value) => {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    const [y, m, d] = value.slice(0, 10).split("-").map(Number);
    return new Date(y, m - 1, d);
  }
  const d = new Date(value); d.setHours(0, 0, 0, 0); return d;
};
const daysBetween = (from, to) => Math.round((startOfDay(to) - startOfDay(from)) / DAY);

/** Longest allowed gap between reviews with `daysLeft` until the exam (about a third of it). */
export function examGapCap(daysLeft) {
  return Math.max(1, Math.floor(daysLeft / 3));
}

/** Shorten one review interval (days) so it fits before the exam; unchanged without a future exam. */
export function capIntervalForExam(intervalDays, now, examDate) {
  if (!examDate) return intervalDays;
  const daysLeft = daysBetween(now, examDate);
  if (!Number.isFinite(daysLeft) || daysLeft <= 0) return intervalDays;
  const lastUsefulDay = Math.max(0, daysLeft - 1);
  return Math.max(0, Math.min(intervalDays, examGapCap(daysLeft), lastUsefulDay));
}

/**
 * Review days after an activity on `base`: first review by confidence, then
 * expanding gaps capped by exam distance, ending on the day before the exam.
 */
export function examAwareReviewDays(base, confidenceRating, examDate) {
  const start = startOfDay(base);
  const daysLeft = daysBetween(start, examDate);
  if (!Number.isFinite(daysLeft) || daysLeft <= 1) return [];
  const lastDay = daysLeft - 1;
  const cap = examGapCap(daysLeft);
  const first = Math.min(lastDay, confidenceRating === "good" ? 2 : 1);
  const offsets = [first];
  const growth = [2, 4, 7, 14, 30];
  let at = first;
  for (let i = 0; at < lastDay; i++) {
    at = Math.min(lastDay, at + Math.min(growth[Math.min(i, growth.length - 1)], cap));
    offsets.push(at);
  }
  return [...new Set(offsets)].map((offset) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + offset));
}
