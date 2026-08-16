/**
 * Logging a pre-read — deliberately NOT `appendActivity`.
 *
 * A pre-read happens before the lecture is taught. It is worth recording (it
 * proves coverage started, and its missed questions tell lecture day where to
 * open) but it must not look like study to the ranking:
 *
 * - `appendActivity` recomputes `reviewDates` on every write, and
 *   `lectureUrgency` adds +20 for `nextReview <= today`. A pre-read would
 *   therefore push an untaught lecture to the top of Today.
 * - It also bumps `sessionCount`, and `recommendedSessionsFor` branches on
 *   `sessions === 0` to offer the first Deep Learn. A pre-read must leave that
 *   first-pass recommendation intact.
 *
 * So this writes the activity entry and nothing else. Rep 0, by construction.
 */

const PRE_READ_CONFIDENCE = "okay";

export const PRE_READ_ACTIVITY = "preread";

export const completionKey = (lectureId, blockId) => `${lectureId}__${blockId}`;

const toDateString = (value) => new Date(value).toISOString().slice(0, 10);

/**
 * @returns {{store: object, key: string, entry: object}|null} null when there is
 *   nothing to record, matching appendActivity's contract.
 */
export function appendPreRead(
  store,
  { lectureId, blockId, now = new Date(), gapObjectiveIds = [], durationMinutes = null, note = null, id } = {}
) {
  if (!lectureId || !blockId) return null;

  const date = toDateString(now);
  const key = completionKey(lectureId, blockId);
  const current = store?.[key] || null;

  const activity = {
    id: id ?? (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `act_${Date.now()}`),
    date,
    activityType: PRE_READ_ACTIVITY,
    // The trend calculation reads confidenceRating off the head of the log;
    // "okay" keeps a pre-read neutral rather than reading as a decline.
    confidenceRating: PRE_READ_CONFIDENCE,
    durationMinutes,
    note,
  };

  const activityLog = [activity, ...(Array.isArray(current?.activityLog) ? current.activityLog : [])].sort(
    (a, b) => new Date(b?.date || 0) - new Date(a?.date || 0)
  );

  const entry = {
    ...(current || {}),
    lectureId,
    blockId,
    ankiInRotation: !!current?.ankiInRotation,
    firstCompletedDate: current?.firstCompletedDate || date,
    lastActivityDate: activityLog[0]?.date || date,
    lastConfidence: activityLog[0]?.confidenceRating || PRE_READ_CONFIDENCE,
    // Untouched on purpose — see the module comment.
    reviewDates: current?.reviewDates ?? [],
    sessionCount: current?.sessionCount ?? 0,
    activityLog,
    preRead: {
      date,
      gapObjectiveIds: [...gapObjectiveIds],
    },
  };

  return { store: { ...(store || {}), [key]: entry }, key, entry };
}
