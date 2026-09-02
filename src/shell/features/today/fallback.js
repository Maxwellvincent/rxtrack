/**
 * SP1 T4.3 — what Today shows when the day planner has nothing to place.
 *
 * The planner only schedules lectures that have a date, and in practice no
 * lecture in this account has one: no `lectureDate` anywhere, and the blocks
 * with future exams have no week numbers to derive one from. App behaves the
 * same way, which means its Today is empty too.
 *
 * Rather than change the scheduler — its output is pinned by the T4.2 fixtures —
 * this sits on top: when day 0 is empty, fall back to the urgency ranking the
 * scheduler already computed, which does not depend on dates at all. Tasks are
 * marked `urgency-fallback` so the UI can say why they are there.
 */

export const FALLBACK_LIMIT = 6;
export const CATCH_UP_LIMIT = 2;
export const CATCH_UP_WINDOW_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

function localDay(dateLike) {
  const date = dateLike instanceof Date ? new Date(dateLike) : new Date(dateLike);
  if (Number.isNaN(date.getTime())) return null;
  date.setHours(0, 0, 0, 0);
  return date;
}

/** Recent, never-started lectures that slipped past their scheduled day. */
export function catchUpTasks(daily, { today = new Date(), limit = CATCH_UP_LIMIT } = {}) {
  const todayDate = localDay(today);
  if (!todayDate || limit <= 0) return [];

  return (daily?.lecScores || [])
    .filter((ls) => {
      const available = localDay(ls.availableDate);
      if (!available || available >= todayDate) return false;
      const daysLate = Math.round((todayDate - available) / DAY_MS);
      return daysLate <= CATCH_UP_WINDOW_DAYS
        && (ls.sessions ?? 0) === 0
        && ls.recommendedSessions?.length > 0;
    })
    .sort((a, b) => {
      // Recover the most recently missed lecture first; urgency breaks ties.
      const dateDiff = localDay(b.availableDate) - localDay(a.availableDate);
      return dateDiff || (b.urgency ?? 0) - (a.urgency ?? 0);
    })
    .slice(0, limit)
    .map((ls) => ({
      ...ls,
      dateStr: todayDate.toISOString().slice(0, 10),
      catchUpDays: Math.round((todayDate - localDay(ls.availableDate)) / DAY_MS),
      matchReason: "catch-up",
    }));
}

/** Tasks the planner placed on day 0, or [] when the first day is later. */
export function scheduledToday(daily) {
  const first = daily?.schedule?.[0];
  return first && first.daysFromNow === 0 ? first.tasks : [];
}

/**
 * @returns {{tasks: object[], reason: "scheduled"|"urgency-fallback"|"none"}}
 */
export function todayTasks(daily, { limit = FALLBACK_LIMIT, todayStr } = {}) {
  const scheduled = scheduledToday(daily);
  if (scheduled.length) {
    const scheduledIds = new Set(scheduled.map((task) => task.lec?.id));
    const room = Math.max(0, limit - scheduled.length);
    const today = todayStr ? new Date(`${todayStr}T00:00:00`) : new Date();
    const unscheduledDaily = {
      ...daily,
      lecScores: (daily?.lecScores || []).filter((task) => !scheduledIds.has(task.lec?.id)),
    };
    const catchUps = catchUpTasks(unscheduledDaily, { today, limit: Math.min(CATCH_UP_LIMIT, room) });
    return {
      tasks: [...scheduled, ...catchUps],
      reason: catchUps.length ? "scheduled-with-catch-up" : "scheduled",
    };
  }

  const candidates = (daily?.lecScores || []).filter(
    // Something to actually do, and not a lecture that has not happened yet.
    (ls) => ls.recommendedSessions?.length > 0 && !ls.isFuture
  );
  if (!candidates.length) return { tasks: [], reason: "none" };

  const dateStr = todayStr ?? new Date().toISOString().slice(0, 10);
  return {
    tasks: candidates.slice(0, limit).map((ls) => ({
      ...ls,
      dateStr,
      matchReason: "urgency-fallback",
    })),
    reason: "urgency-fallback",
  };
}
