/**
 * SP1 T4.3 — Today's data + actions, on the store hooks.
 *
 * Reads through the hooks, assembles a ScheduleContext, runs the pure
 * schedulers, and exposes the real action paths: log an Anki session, log a
 * review, and hand a lecture's objectives to the quiz launcher.
 */
import { useCallback, useMemo } from "react";
import * as completionStore from "../../../stores/completion.js";
import { getStoreHookUserId } from "../../hooks/currentUser.js";
import { useCompletion } from "../../hooks/useCompletion.js";
import { useExamDates } from "../../hooks/useExamDates.js";
import { useLectures } from "../../hooks/useLectures.js";
import { useObjectives } from "../../hooks/useObjectives.js";
import { usePerformance } from "../../hooks/usePerformance.js";
import { useTerms } from "../../hooks/useTerms.js";
import { useWeakConcepts } from "../../hooks/useWeakConcepts.js";
import { appendActivity } from "../../logic/completionLog.js";
import { buildStudySchedule, generateDailySchedule, objectivesForLecture } from "../../logic/schedule.js";
import { buildScheduleContext } from "./scheduleContext.js";

/** App fired this so other surfaces re-read completion; keep the contract. */
function emitCompletionUpdated() {
  try {
    window.dispatchEvent(new CustomEvent("rxt-completion-updated"));
  } catch { /* non-DOM env */ }
}

export function useToday(blockId, userId, { now } = {}) {
  const terms = useTerms(userId);
  const lectures = useLectures(null, userId);
  const objectives = useObjectives(null, userId);
  const performance = usePerformance(userId);
  const completion = useCompletion(userId);
  const examDates = useExamDates(userId);
  const weakConcepts = useWeakConcepts(null, userId);

  const context = useMemo(
    () =>
      buildScheduleContext({
        blockId,
        terms: terms.data,
        lectures: lectures.data,
        objectives: objectives.data,
        performance: performance.data,
        completion: completion.data,
        examDates: examDates.data,
        weakConcepts: weakConcepts.data,
        now: now ?? new Date(),
      }),
    [blockId, terms.data, lectures.data, objectives.data, performance.data, completion.data, examDates.data, weakConcepts.data, now]
  );

  const daily = useMemo(() => generateDailySchedule(context), [context]);
  const study = useMemo(() => buildStudySchedule(context), [context]);

  // The first day of the plan is "today" only when it is day 0 — a schedule
  // whose first entry is further out has nothing due right now.
  const todayTasks = useMemo(() => {
    const first = daily?.schedule?.[0];
    return first && first.daysFromNow === 0 ? first.tasks : [];
  }, [daily]);

  const mutateCompletion = completion.mutate;
  const logActivity = useCallback(
    ({ lectureId, activityType, confidenceRating, durationMinutes = null, note = null }) => {
      const uid = userId ?? getStoreHookUserId();
      const current = completionStore.read(uid) || {};
      const result = appendActivity(current, {
        lectureId,
        blockId,
        activityType,
        confidenceRating,
        examDate: context.examDate,
        durationMinutes,
        note,
        now: new Date(),
      });
      if (!result) return null;
      mutateCompletion(result.store);
      emitCompletionUpdated();
      return result.entry;
    },
    [blockId, userId, context.examDate, mutateCompletion]
  );

  /** Objectives for one lecture, ready for the objective-quiz launcher. */
  const objectivesForTask = useCallback(
    (lectureId) => {
      const lecture = context.lectures.find((l) => l.id === lectureId);
      return lecture ? objectivesForLecture(context.objectives, lecture) : [];
    },
    [context.lectures, context.objectives]
  );

  return {
    context,
    daily,
    study,
    todayTasks,
    examDate: context.examDate,
    daysLeft: daily?.daysLeft ?? null,
    logActivity,
    objectivesForTask,
  };
}
