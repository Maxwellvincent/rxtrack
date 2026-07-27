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
  if (scheduled.length) return { tasks: scheduled, reason: "scheduled" };

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
