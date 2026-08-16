/**
 * Work Ahead — the lectures you can legitimately pre-read.
 *
 * `generateDailySchedule` has always computed an `upcoming` list of future-dated
 * lectures and thrown it away; every surface filters future lectures out
 * (`fallback.js` drops `isFuture`, the day planner's passes all require
 * `availableDate <= date`). That is correct for "what should I do today" and
 * wrong for "I'm caught up, what's next" — the case this module answers.
 *
 * Pure, and read-only with respect to the scheduler: the T4.2 fixtures pin
 * `generateDailySchedule`'s output, so this consumes `lecScores` rather than
 * changing how they are produced.
 */

import { pressureZone } from "./schedule.js";

/** Default horizon: tomorrow and the day after. Beyond that, pre-reading goes stale. */
export const HORIZON_DAYS = 2;

/** Zones where pre-reading loses to consolidating what the exam actually covers. */
const SUPPRESSED_ZONES = new Set(["crunch", "critical", "exam"]);

const startOfDay = (value) => {
  const d = new Date(value);
  d.setHours(0, 0, 0, 0);
  return d;
};

export function workAheadLectures(
  daily,
  { now = new Date(), horizonDays = HORIZON_DAYS, examDate = null } = {}
) {
  const today = startOfDay(now);
  const cutoff = new Date(today);
  cutoff.setDate(today.getDate() + horizonDays);

  const lectures = (daily?.lecScores || []).filter(
    (ls) => ls.availableDate && ls.availableDate > today && ls.availableDate <= cutoff
  );

  // Hidden, not removed: the section stays expandable by hand so working ahead
  // is always possible, just never the app's suggestion inside exam week.
  const zone = examDate ? pressureZone(examDate, now).zone : "normal";
  const hidden = SUPPRESSED_ZONES.has(zone);

  // "Caught up" is not an empty day-0 list — `fallback.js` back-fills six
  // urgency tasks, so day 0 is essentially never empty and a gate on emptiness
  // would never fire. Nothing on fire means: no struggling objectives anywhere
  // in the block, and no spaced repetition already overdue.
  const backlog = (daily?.lecScores || []).some(
    (ls) =>
      !ls.isFuture &&
      ((ls.struggling || 0) > 0 || (ls.nextReview && startOfDay(ls.nextReview) < today))
  );
  const expanded = !hidden && !backlog && lectures.length > 0;

  return { lectures, hidden, expanded, backlog, zone };
}
