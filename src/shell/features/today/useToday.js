/**
 * SP1 T4.3 — Today's data + actions, on the store hooks.
 *
 * Reads through the hooks, assembles a ScheduleContext, runs the pure
 * schedulers, and exposes the real action paths: log an Anki session, log a
 * review, and hand a lecture's objectives to the quiz launcher.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import * as completionStore from "../../../stores/completion.js";
import { getStoreHookUserId } from "../../hooks/currentUser.js";
import { useCompletion } from "../../hooks/useCompletion.js";
import { useExamDates } from "../../hooks/useExamDates.js";
import { useLectures } from "../../hooks/useLectures.js";
import { useObjectives } from "../../hooks/useObjectives.js";
import { usePerformance } from "../../hooks/usePerformance.js";
import { useTerms } from "../../hooks/useTerms.js";
import { useWeakConcepts } from "../../hooks/useWeakConcepts.js";
import { appendActivity, localDateString } from "../../logic/completionLog.js";
import { appendPreRead } from "../../logic/preReadLog.js";
import { buildStudySchedule, generateDailySchedule, objectivesForLecture } from "../../logic/schedule.js";
import { workAheadLectures } from "../../logic/workAhead.js";
import { buildScheduleContext } from "./scheduleContext.js";
import { todayTasks as todayTasks_ } from "./fallback.js";

/**
 * Build Today even when an imported block has not populated the separate exam-date store yet.
 * The block metadata remains authoritative when it has an exam date; otherwise a bounded
 * synthetic horizon lets the lecture scorer expose dated or urgent lectures instead of returning
 * an empty plan solely because the horizon is missing.
 */
export function buildTodaySchedule(context) {
  const scheduled = generateDailySchedule(context);
  if (scheduled || !context?.lectures?.length) return scheduled;
  const fallbackExam = new Date(context.now || new Date());
  fallbackExam.setDate(fallbackExam.getDate() + 365);
  return generateDailySchedule({
    ...context,
    examDate: fallbackExam.toISOString(),
    examDates: { ...(context.examDates || {}), [context.blockId]: fallbackExam.toISOString() },
  });
}

/** App fired this so other surfaces re-read completion; keep the contract. */
function emitCompletionUpdated() {
  try {
    window.dispatchEvent(new CustomEvent("rxt-completion-updated"));
  } catch { /* non-DOM env */ }
}

export function millisecondsUntilNextLocalDay(now = new Date()) {
  const next = new Date(now);
  next.setHours(24, 0, 1, 0);
  return Math.max(1, next.getTime() - new Date(now).getTime());
}

/** Keep long-lived tabs on the current local calendar day. */
function useLiveNow(explicitNow) {
  const [liveNow, setLiveNow] = useState(() => explicitNow ?? new Date());

  useEffect(() => {
    if (explicitNow != null) return undefined;

    let timer;
    const scheduleRollover = (current) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const next = new Date();
        setLiveNow(next);
        scheduleRollover(next);
      }, millisecondsUntilNextLocalDay(current));
    };
    const refresh = () => {
      const current = new Date();
      setLiveNow(current);
      scheduleRollover(current);
    };
    const onVisible = () => { if (document.visibilityState !== "hidden") refresh(); };
    scheduleRollover(new Date());
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [explicitNow]);

  return explicitNow ?? liveNow;
}

export function useToday(blockId, userId, { now } = {}) {
  // Stable between day changes, but refreshed after local midnight and whenever
  // a backgrounded tab returns. This preserves memo stability without leaving
  // Today permanently pinned to the date on which the component mounted.
  const nowValue = useLiveNow(now);
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
        now: nowValue,
      }),
    [blockId, terms.data, lectures.data, objectives.data, performance.data, completion.data, examDates.data, weakConcepts.data, nowValue]
  );

  const daily = useMemo(() => buildTodaySchedule(context), [context]);
  const study = useMemo(() => buildStudySchedule(context), [context]);

  // Day 0 if the planner placed anything there, else the urgency fallback —
  // see fallback.js for why that is needed at all.
  const { tasks: todayTasks, reason: todayReason } = useMemo(() => todayTasks_(daily), [daily]);

  // The first day the planner DID place work on, when that is not today — a
  // block whose term has not started yet has a real plan, just not for now.
  const nextDay = useMemo(() => {
    const first = daily?.schedule?.[0];
    return first && first.daysFromNow > 0 ? first : null;
  }, [daily]);

  // Lectures you may legitimately pre-read: dated inside the next two days,
  // suppressed inside exam week. Read-only over the scheduler's own output.
  const workAhead = useMemo(
    () => workAheadLectures(daily, { now: context.now, examDate: context.examDate }),
    [daily, context.now, context.examDate]
  );

  // Map lectureId → next scheduled review date string from buildStudySchedule.
  const nextReviewByLectureId = useMemo(() => {
    const map = {};
    const todayStr = localDateString(context.now);
    for (const [dateStr, items] of study?.schedule || []) {
      if (dateStr < todayStr) continue;
      for (const item of items || []) {
        if (item?.lectureId && !map[item.lectureId]) {
          map[item.lectureId] = dateStr;
        }
      }
    }
    return map;
  }, [study, context.now]);

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

  /**
   * Record a pre-read. Deliberately NOT `logActivity`: a pre-read must not
   * schedule a review or count a rep — see preReadLog.js.
   */
  const logPreRead = useCallback(
    ({ lectureId, gapObjectiveIds = [], durationMinutes = null }) => {
      const uid = userId ?? getStoreHookUserId();
      const current = completionStore.read(uid) || {};
      const result = appendPreRead(current, {
        lectureId,
        blockId,
        gapObjectiveIds,
        durationMinutes,
        now: new Date(),
      });
      if (!result) return null;
      mutateCompletion(result.store);
      emitCompletionUpdated();
      return result.entry;
    },
    [blockId, userId, mutateCompletion]
  );

  /** The pre-read on record for a lecture, or null. Drives the lecture-day badge. */
  const preReadFor = useCallback(
    (lectureId) => context.completion?.[`${lectureId}__${blockId}`]?.preRead ?? null,
    [context.completion, blockId]
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
    todayReason,
    nextDay,
    examDate: context.examDate,
    daysLeft: daily?.daysLeft ?? null,
    logActivity,
    logPreRead,
    preReadFor,
    workAhead,
    objectivesForTask,
    nextReviewByLectureId,
    todayKey: localDateString(context.now),
  };
}
