/**
 * SP1 T4.1/T4.2 — the fixture projection.
 *
 * Schedule outputs echo their inputs (every task carried its objective objects),
 * so fixtures store decisions only. Both sides of the parity check go through
 * here: the probe when recording App's output, the test when checking the pure
 * module's. Keeping it in one place is what makes "same shape in, same shape
 * out" an actual comparison rather than two similar-looking transforms.
 *
 * This outlives the probe — T4.2 deletes `src/devtools/scheduleProbe.js`, and
 * the fixture assertions stay.
 */

const objectiveIds = (list) => (list || []).map((o) => o?.id ?? null);
const iso = (value) => (value ? new Date(value).toISOString() : null);

/** Study-schedule output, minus the objective objects echoed into every item. */
export function studyScheduleShape(result) {
  if (!result) return null;
  return {
    examDate: result.examDate,
    daysLeft: result.daysLeft,
    totalSessions: result.totalSessions,
    criticalCount: result.criticalCount,
    lecturePlans: (result.lecturePlans || []).map((p) => ({
      lectureId: p.lec?.id ?? null,
      struggling: p.struggling,
      untested: p.untested,
      mastered: p.mastered,
      total: p.total,
      lastScore: p.lastScore,
      sessionsDone: p.sessionsDone,
      confidence: p.confidence,
      isStruggling: p.isStruggling,
      requiredReps: p.requiredReps,
      repsRemaining: p.repsRemaining,
      baseIntervals: p.baseIntervals,
      studyMode: p.studyMode,
      priority: p.priority,
      objectiveIds: objectiveIds(p.lecObjs),
    })),
    schedule: (result.schedule || []).map(([date, items]) => [
      date,
      (items || []).map((i) => ({
        lectureId: i.lectureId,
        // `?? null` on both sides: App produced `undefined` for a lecture with
        // neither title nor fileName (the key vanished through JSON), the pure
        // module produces `null` from the same absent fields. Same meaning —
        // normalise so the comparison is about behaviour, not serialisation.
        lectureTitle: i.lectureTitle ?? null,
        lectureType: i.lectureType,
        lectureNum: i.lectureNum ?? null,
        repNumber: i.repNumber,
        totalReps: i.totalReps,
        isStruggling: i.isStruggling,
        priority: i.priority,
        studyMode: i.studyMode,
        blockId: i.blockId,
        objectiveIds: objectiveIds(i.objectives),
      })),
    ]),
  };
}

const lecScoreShape = (ls) => ({
  lectureId: ls.lec?.id ?? null,
  urgency: ls.urgency,
  struggling: ls.struggling,
  untested: ls.untested,
  mastered: ls.mastered,
  total: ls.total,
  avgBloom: ls.avgBloom,
  lastScore: ls.lastScore,
  confidence: ls.confidence,
  nextReview: iso(ls.nextReview),
  sessions: ls.sessions,
  availableDate: iso(ls.availableDate),
  isAvailableToday: ls.isAvailableToday,
  isFuture: ls.isFuture,
  daysUntilAvailable: ls.daysUntilAvailable,
  hasNoDate: ls.hasNoDate,
  recommendedSessions: (ls.recommendedSessions || []).map((r) => ({
    type: r.type,
    label: r.label,
    reason: r.reason,
    duration: r.duration,
  })),
});

/** Daily-schedule output: urgency, ordering and task shape, without the echo. */
export function dailyScheduleShape(result) {
  if (!result) return null;
  return {
    daysLeft: result.daysLeft,
    needsBlockStart: result.needsBlockStart,
    schedule: (result.schedule || []).map((day) => ({
      dateStr: day.dateStr,
      daysFromNow: day.daysFromNow,
      dayLabel: day.dayLabel,
      tasks: (day.tasks || []).map((t) => ({
        ...lecScoreShape(t),
        dateStr: t.dateStr,
        matchReason: t.matchReason,
      })),
    })),
    lecScores: (result.lecScores || []).map(lecScoreShape),
    upcoming: (result.upcoming || []).map((ls) => ls.lec?.id ?? null),
    undated: (result.undated || []).map((ls) => ls.lec?.id ?? null),
  };
}

export function outputShape({ studySchedule, dailySchedule }) {
  return {
    studySchedule: studyScheduleShape(studySchedule),
    dailySchedule: dailyScheduleShape(dailySchedule),
  };
}
