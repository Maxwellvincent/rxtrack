/**
 * SP1 T4.3 — logging study activity, ported from App's logActivityToCompletion.
 *
 * Today's real action paths (log an Anki session, mark a review done) write
 * here. Pure: takes the current `rxt-completion` map and returns the next one,
 * so the caller owns the store write and a test can assert the exact shape.
 *
 * NOTE: two different `computeReviewDates` exist in this codebase — App's
 * (fixed intervals + a Saturday sweep + monthly repeats to the exam) and
 * Tracker's (confidence intervals compressed by exam pressure). App's is what
 * has been writing these records, so App's is what is ported. Reconciling them
 * is a product decision, not a porting one.
 */

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Local midnight — reconciled with schedule.js (2026-07-27).
 *
 * This used to reproduce App's bug: a "YYYY-MM-DD" parsed as UTC and then
 * normalised to local midnight lands a day early west of Greenwich, so every
 * review was scheduled one day before it was meant to be. A calendar date is
 * built in local time now. Review dates already stored keep whatever App wrote;
 * only new activity is spaced correctly, and the drift is at most a day.
 */
const startOfDay = (value) => {
  const iso = typeof value === "string" ? value.match(DATE_ONLY) : null;
  const d = iso ? new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])) : new Date(value);
  d.setHours(0, 0, 0, 0);
  return d;
};

const addDays = (date, days) => {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  d.setHours(0, 0, 0, 0);
  return d;
};

export function getNextSaturday(fromDate) {
  const d = startOfDay(fromDate);
  d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7));
  return d;
}

/** Review schedule after an activity: first pass, weekend sweep, then spacing. */
export function computeReviewDates(completedDate, confidenceRating, examDate) {
  const base = startOfDay(completedDate);
  const exam = examDate ? startOfDay(examDate) : null;

  const firstIntervalDays = confidenceRating === "good" ? 2 : confidenceRating === "okay" ? 1 : 0;
  const first = addDays(base, firstIntervalDays);
  const dates = [first, getNextSaturday(first), addDays(base, 7), addDays(base, 14), addDays(base, 30)];

  if (exam) {
    const monthly = addDays(base, 30);
    while (monthly <= exam) {
      dates.push(new Date(monthly));
      monthly.setMonth(monthly.getMonth() + 1);
      monthly.setHours(0, 0, 0, 0);
    }
  }

  const unique = new Map();
  for (const d of dates) {
    if (!d || Number.isNaN(d.getTime())) continue;
    if (exam && d > exam) continue; // nothing past the exam is worth scheduling
    unique.set(d.toISOString().slice(0, 10), d);
  }
  return [...unique.values()].sort((a, b) => a.getTime() - b.getTime());
}

const toDateString = (value, fallback) => {
  if (typeof value === "string" && value.length >= 10) return value.slice(0, 10);
  if (value) return new Date(value).toISOString().slice(0, 10);
  return fallback;
};

export const localDateString = (value = new Date()) => {
  const d = new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export const completionKey = (lectureId, blockId) => `${lectureId}__${blockId}`;

/**
 * Append one activity to the completion record for a lecture.
 *
 * @returns {{store: object, key: string, entry: object}|null} null when there is
 *   nothing to record, so a caller can skip the write entirely.
 */
export function appendActivity(store, { lectureId, blockId, activityType, confidenceRating, date, examDate, durationMinutes = null, note = null, now = new Date(), id }) {
  if (!lectureId || !blockId) return null;

  const activityDate = toDateString(date, localDateString(now));
  const key = completionKey(lectureId, blockId);
  const current = store?.[key] || null;

  const activity = {
    id: id ?? (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `act_${Date.now()}`),
    date: activityDate,
    activityType: activityType || "manual",
    confidenceRating: confidenceRating || "okay",
    durationMinutes,
    note,
  };

  // Newest first — the trend calculation reads the head of this list.
  const activityLog = [activity, ...(Array.isArray(current?.activityLog) ? current.activityLog : [])].sort(
    (a, b) => new Date(b?.date || 0) - new Date(a?.date || 0)
  );

  const lastActivityDate = activityLog[0]?.date || activityDate;
  const lastConfidence = activityLog[0]?.confidenceRating || activity.confidenceRating;

  const entry = {
    ...(current || {}),
    lectureId,
    blockId,
    ankiInRotation: activity.activityType === "anki" ? true : !!current?.ankiInRotation,
    ankiCardCount: current?.ankiCardCount ?? null,
    ankiCardsOverdue: current?.ankiCardsOverdue ?? null,
    lastAnkiLogDate: current?.lastAnkiLogDate ?? null,
    firstCompletedDate: current?.firstCompletedDate || activityDate,
    lastActivityDate,
    lastConfidence,
    reviewDates: computeReviewDates(lastActivityDate.slice(0, 10), lastConfidence, examDate || null).map((d) =>
      d.toISOString().slice(0, 10)
    ),
    activityLog,
    sessionCount: (current?.sessionCount ?? 0) + 1,
  };

  return { store: { ...(store || {}), [key]: entry }, key, entry };
}
