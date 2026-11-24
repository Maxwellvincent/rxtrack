import { computeReviewDates } from "../../logic/completionLog.js";
import { lectureCompletion } from "../../../engine/lectureCompletion.js";

const pad = (n) => String(n).padStart(2, "0");
export const dateKey = (value) => { const d = new Date(value); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const keyToDate = (key) => { const [y, m, d] = String(key).slice(0, 10).split("-").map(Number); return new Date(y, m - 1, d); };

/** Monday of the week containing `value`, shifted by `weekOffset` weeks. */
export function weekStart(value, weekOffset = 0) {
  const d = new Date(value); d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + weekOffset * 7);
  return d;
}

/** Upcoming review days for one lecture; stored dates are re-spaced against the exam. */
export function reviewDaysFor(entry, perfNextReview, examDate) {
  const days = new Set();
  if (entry?.lastActivityDate) {
    const recomputed = examDate ? computeReviewDates(entry.lastActivityDate, entry.lastConfidence || "okay", examDate) : [];
    for (const d of recomputed) days.add(dateKey(d));
    if (!recomputed.length) for (const d of entry.reviewDates || []) days.add(String(d).slice(0, 10));
  }
  if (perfNextReview) days.add(dateKey(perfNextReview));
  return days;
}

/**
 * One week of lectures by the day they were given, plus reviews due each day.
 * lecScores rows come from generateDailySchedule (lec, availableDate, nextReview).
 */
export function buildWeekCalendar({ lecScores = [], completion = {}, blockId, now = Date.now(), weekOffset = 0, examDate = null, objectivesFor = () => [], evidence = {} }) {
  const start = weekStart(now, weekOffset);
  const todayKey = dateKey(now);
  const examKey = examDate ? dateKey(keyToDate(String(examDate).slice(0, 10))) : null;
  const rows = lecScores.map((row) => {
    const lec = row.lec;
    const entry = completion[`${lec.id}__${blockId}`];
    const firstPass = lectureCompletion(objectivesFor(lec.id), evidence);
    return {
      id: lec.id,
      title: lec.lectureTitle || lec.fileName || lec.filename || "Lecture",
      type: lec.lectureType || "Lec",
      number: lec.lectureNumber ?? null,
      givenOn: row.availableDate ? dateKey(row.availableDate) : null,
      reviews: reviewDaysFor(entry, row.nextReview, examDate),
      firstPass,
      lastActivity: entry?.lastActivityDate || null,
    };
  });
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = new Date(start); date.setDate(start.getDate() + i);
    const key = dateKey(date);
    const given = rows.filter((row) => row.givenOn === key)
      .sort((a, b) => (a.number ?? 999) - (b.number ?? 999) || a.title.localeCompare(b.title));
    // Reviews only from today on; past days show what was given, not missed reminders.
    const reviews = key >= todayKey ? rows.filter((row) => row.givenOn !== key && row.reviews.has(key)) : [];
    return { key, date, isToday: key === todayKey, isPast: key < todayKey, isExam: key === examKey, isWeekend: i >= 5, given, reviews };
  });
  return { start, days, label: `${days[0].date.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${days[6].date.toLocaleDateString("en-US", { month: "short", day: "numeric" })}` };
}
