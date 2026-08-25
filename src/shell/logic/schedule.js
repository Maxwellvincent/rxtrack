/**
 * SP1 T4.2 — the two schedulers, extracted from App.jsx as pure functions.
 *
 * Both take an explicit ScheduleContext and nothing else:
 *
 *   {
 *     blockId, now,                     // now is INPUT — App called new Date()
 *     terms, blockMeta,                 // blockMeta is resolved DATA, never a
 *                                       // resolver callback: no App closure may
 *                                       // leak into this module
 *     lectures,                         // already filtered to the block
 *     objectives,                       // already deduped, as App passed them
 *     examDates, examDate,
 *     performance, lecturePerformance,  // raw map + per-lecture getLecPerf results
 *     completion, reviewedLectures, studyModeByLecture, weakConcepts
 *   }
 *
 * Behaviour is ported 1:1 and proven against the fixtures in `__fixtures__/`,
 * captured from the running App (T4.1). Where App looked odd, it is reproduced
 * as-is and the oddity is commented rather than fixed — a behaviour change here
 * would be invisible in the Today flip and impossible to attribute later.
 */

import { flattenWeakConcepts, isLandmine } from "../features/tracker/weakConcepts.js";

const DAY_MS = 1000 * 60 * 60 * 24;

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Local midnight.
 *
 * DELIBERATE DIVERGENCE FROM App.jsx (2026-07-27): App did `new Date("2026-09-01")`
 * — parsed as UTC — then `setHours(0,0,0,0)`, which lands on Aug 31 anywhere west
 * of Greenwich. Every dated lecture was scheduled a day early. That was invisible
 * while no lecture had a date; the schedule importer's date fix made it visible
 * immediately. A "YYYY-MM-DD" is a calendar date, not an instant, so it is built
 * in local time. See __fixtures__/README.md.
 */
function startOfDay(value) {
  const iso = typeof value === "string" ? value.match(DATE_ONLY) : null;
  const d = iso ? new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])) : new Date(value);
  d.setHours(0, 0, 0, 0);
  return d;
}

function daysBetween(from, to) {
  return Math.ceil((to - from) / DAY_MS);
}

/** Objectives belonging to a lecture, including any it was merged from. */
export function objectivesForLecture(objectives, lecture) {
  return (objectives || []).filter(
    (o) =>
      o.linkedLecId === lecture.id ||
      (lecture.mergedFrom || []).some((m) => m && m.id === o.linkedLecId)
  );
}

export function statusTally(lectureObjectives) {
  const list = lectureObjectives || [];
  return {
    mastered:   list.filter((o) => o.status === "mastered").length,
    inprogress: list.filter((o) => o.status === "inprogress" || o.status === "developing" || o.status === "in_progress").length,
    struggling: list.filter((o) => o.status === "struggling").length,
    untested:   list.filter((o) => !o.status || o.status === "untested").length,
    total:      list.length,
  };
}

// ── buildStudySchedule ──────────────────────────────────────────────────────

/**
 * Spaced-repetition plan to the exam: how many reps each lecture still needs,
 * spread over days at most MAX_PER_DAY apart.
 */
export function buildStudySchedule(context) {
  const { blockId, lectures = [], objectives = [], performance = {} } = context;
  const examDate = context.examDate ?? context.examDates?.[blockId];
  if (!examDate) return null;

  const comprehensiveExamDate = context.examDates?.__comprehensive ?? null;

  const exam = new Date(examDate);
  const today = startOfDay(context.now ?? new Date());
  const daysLeft = daysBetween(today, exam);
  if (daysLeft <= 0) return null;

  const lecturePlans = lectures.map((lec) => {
    const lecObjs = objectivesForLecture(objectives, lec);
    const { struggling, untested, mastered, total } = statusTally(lecObjs);

    // App matched the performance map by key PREFIX, not by exact key.
    const lecPerfKey = Object.keys(performance).find((k) => k.startsWith(lec.id));
    const lecPerf = lecPerfKey ? performance[lecPerfKey] : null;
    const lastScore = lecPerf?.sessions?.slice(-1)[0]?.score ?? null;
    const sessionsDone = lecPerf?.sessions?.length || 0;
    const confidence = lecPerf?.confidenceLevel || "Low";

    const isStruggling = struggling > 0 || (lastScore !== null && lastScore < 60);
    // Fully mastered lectures still get one comprehensive-exam review pass when
    // the comp exam is within 30 days and the lecture hasn't been touched in > 14d.
    const isFullyMastered = total > 0 && mastered === total && !isStruggling;
    const lastSessionAt = lecPerf?.sessions?.[0]?.at ?? null;
    const daysSinceLast = lastSessionAt
      ? Math.round((today - new Date(lastSessionAt)) / DAY_MS)
      : 999;
    const compDaysLeft = comprehensiveExamDate
      ? Math.max(0, daysBetween(today, startOfDay(comprehensiveExamDate)))
      : Infinity;
    const needsCompReview = isFullyMastered && comprehensiveExamDate && compDaysLeft < 30 && daysSinceLast > 14;

    const requiredReps = isStruggling ? 5 : confidence === "High" ? 3 : 4;
    const baseRequired = needsCompReview ? 1 : requiredReps;
    const repsRemaining = needsCompReview
      ? (daysSinceLast > 14 ? 1 : 0)
      : Math.max(0, requiredReps - sessionsDone);
    const baseIntervals = isStruggling ? [1, 2, 4, 7, 12] : needsCompReview ? [Math.max(1, Math.round(compDaysLeft / 2))] : [1, 3, 7, 14, 21];

    return {
      lec,
      lecObjs,
      struggling,
      untested,
      mastered,
      total,
      lastScore,
      sessionsDone,
      confidence,
      isStruggling,
      isFullyMastered,
      needsCompReview,
      requiredReps: baseRequired,
      repsRemaining,
      baseIntervals,
      studyMode: context.studyModeByLecture?.[lec.id] ?? null,
      priority: isStruggling
        ? "critical"
        : untested > total * 0.5
          ? "high"
          : confidence === "Low"
            ? "high"
            : "normal",
    };
  });

  const MAX_PER_DAY = 3;
  const schedule = {};

  // Full day pushes to the next one — and if that is full too, the session is
  // dropped rather than pushed further. App's behaviour, preserved.
  const addToDay = (dateObj, item) => {
    const key = dateObj.toISOString().slice(0, 10);
    if (!schedule[key]) schedule[key] = [];
    if (schedule[key].length < MAX_PER_DAY) {
      schedule[key].push(item);
      return true;
    }
    const next = new Date(dateObj);
    next.setDate(next.getDate() + 1);
    if (next < exam) {
      const nextKey = next.toISOString().slice(0, 10);
      if (!schedule[nextKey]) schedule[nextKey] = [];
      if (schedule[nextKey].length < MAX_PER_DAY) {
        schedule[nextKey].push(item);
        return true;
      }
    }
    return false;
  };

  lecturePlans.forEach((plan) => {
    if (plan.repsRemaining <= 0) return;

    let intervals = plan.baseIntervals.slice(0, plan.repsRemaining);
    if (daysLeft < intervals[intervals.length - 1]) {
      const scale = daysLeft / intervals[intervals.length - 1];
      intervals = intervals.map((d, i) => (i === 0 ? 1 : Math.max(i + 1, Math.round(d * scale))));
    }

    intervals.forEach((dayOffset, repIdx) => {
      const sessionDate = new Date(today);
      sessionDate.setDate(today.getDate() + dayOffset);
      if (sessionDate >= exam) return;

      addToDay(sessionDate, {
        lectureId: plan.lec.id,
        lectureTitle: plan.lec.lectureTitle || plan.lec.fileName,
        lectureType: plan.lec.lectureType || "Lec",
        lectureNum: plan.lec.lectureNumber,
        repNumber: plan.sessionsDone + repIdx + 1,
        totalReps: plan.requiredReps,
        isStruggling: plan.isStruggling,
        priority: plan.priority,
        studyMode: plan.studyMode,
        objectives: plan.lecObjs,
        blockId,
      });
    });
  });

  return {
    examDate,
    daysLeft,
    totalSessions: Object.values(schedule).flat().length,
    criticalCount: lecturePlans.filter((p) => p.priority === "critical").length,
    lecturePlans,
    schedule: Object.entries(schedule).sort(([a], [b]) => a.localeCompare(b)),
  };
}

// ── generateDailySchedule ───────────────────────────────────────────────────

export function pressureZone(examDate, now) {
  const today = startOfDay(now ?? new Date());
  const exam = startOfDay(examDate);
  const days = daysBetween(today, exam);
  if (days <= 0) return { zone: "exam", days };
  if (days <= 3) return { zone: "critical", days };
  if (days <= 7) return { zone: "crunch", days };
  if (days <= 14) return { zone: "build", days };
  return { zone: "normal", days };
}

const DOW = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 0 };

/**
 * Map lectureNumber → ISO date string for LEC-type lectures.
 * Used to inherit dates onto DLAs that share the same lecture number.
 */
export function lecDateMap(lectures) {
  const map = {};
  for (const l of (lectures || [])) {
    if ((l.lectureType ?? "LEC").toUpperCase() === "LEC" && l.lectureNumber != null) {
      const d = l.lectureDate || l.date;
      if (d) map[l.lectureNumber] = d;
    }
  }
  return map;
}

/** When a lecture becomes studiable: explicit date, else derived from the block start. */
export function availableDateFor(lecture, blockStart, pairedDate = null) {
  // `date` is what the schedule importer wrote before it was fixed to write
  // `lectureDate`; records from before that fix still only carry `date`.
  const explicit = lecture.lectureDate || lecture.date || pairedDate;
  if (explicit) return { date: startOfDay(explicit), source: "explicit" };

  if (lecture.weekNumber && lecture.dayOfWeek && blockStart) {
    const startDay = blockStart.getDay();
    const toMonday = startDay === 0 ? -6 : 1 - startDay;
    const weekOneMon = new Date(blockStart);
    weekOneMon.setDate(blockStart.getDate() + toMonday);
    const targetDow = DOW[lecture.dayOfWeek] ?? 1;
    const derived = new Date(weekOneMon);
    derived.setDate(
      weekOneMon.getDate() + (lecture.weekNumber - 1) * 7 + (targetDow === 0 ? 6 : targetDow - 1)
    );
    derived.setHours(0, 0, 0, 0);
    return { date: derived, source: "derived" };
  }

  if (lecture.weekNumber && blockStart) {
    const derived = new Date(blockStart);
    derived.setDate(blockStart.getDate() + (lecture.weekNumber - 1) * 7);
    derived.setHours(0, 0, 0, 0);
    return { date: derived, source: "week-only" };
  }

  return { date: null, source: "unknown" };
}

/** Ported from Tracker's getConfidenceTrend — the colours it returned are UI-only. */
export function confidenceTrend(activityLog) {
  if (!activityLog || activityLog.length < 2) return { trend: "new" };
  const scoreMap = { good: 3, okay: 2, struggling: 1 };
  const recent = activityLog
    .slice(0, 5)
    .filter((a) => a.confidenceRating)
    .map((a) => scoreMap[a.confidenceRating] || 0);
  if (recent.length < 2) return { trend: "new" };

  const mid = Math.ceil(recent.length / 2);
  const recentAvg = recent.slice(0, mid).reduce((s, v) => s + v, 0) / mid;
  const olderAvg = recent.slice(mid).reduce((s, v) => s + v, 0) / (recent.length - mid);
  const delta = recentAvg - olderAvg;

  if (delta > 0.4) return { trend: "improving" };
  if (delta < -0.4) return { trend: "declining" };
  if (recentAvg >= 2.5) return { trend: "strong" };
  if (recentAvg <= 1.4) return { trend: "stuck" };
  return { trend: "flat" };
}

/** Urgency score for one lecture. Every term is App's, in App's order. */
/**
 * Non-mastered weak concepts (from DeepLearn misses or an uploaded exam-report
 * score table) linked to this lecture, within this block or lifetime.
 */
export function weakConceptsForLecture(weakConcepts, blockId, lectureId) {
  if (!lectureId) return [];
  return flattenWeakConcepts(weakConcepts, { blockId }).filter(
    (c) => c.masteryLevel !== "mastered" && (c.linkedLecIds || []).includes(lectureId)
  );
}

export function lectureUrgency({ tally, avgBloom, lastScore, confidence, sessions, nextReview, today, reviewed, completion, zone, weakConceptCount = 0, hasLandmineWeakConcept = false }) {
  const { struggling, untested } = tally;
  let urgency = 0;
  urgency += struggling * 10;
  urgency += untested * 3;
  urgency += avgBloom * 2;
  if (lastScore !== null && lastScore < 60) urgency += 15;
  if (lastScore !== null && lastScore < 80) urgency += 5;
  if (confidence === "Low") urgency += 8;
  if (confidence === "Medium") urgency += 3;
  if (sessions === 0) urgency += reviewed ? 8 : 12;
  if (nextReview && nextReview <= today) urgency += 20;
  // A weak concept is a signal independent of objective mastery status (it can
  // come from a DeepLearn miss or an uploaded exam score report), so this adds
  // to — rather than substitutes for — the `struggling` boost above.
  if (weakConceptCount > 0) urgency += Math.min(weakConceptCount * 6, 18);
  if (hasLandmineWeakConcept) urgency += 10;

  const ankiOverdue = completion?.ankiCardsOverdue || 0;
  const ankiTotal = completion?.ankiCardCount || 0;
  if (ankiOverdue > 0 && ankiTotal > 0) {
    const overdueRatio = ankiOverdue / ankiTotal;
    if (overdueRatio >= 0.5) urgency += 20;
    else if (overdueRatio >= 0.25) urgency += 10;
    else urgency += 5;
  }
  if (ankiTotal >= 20 && completion?.lastAnkiLogDate) {
    // App measured this from the wall clock, not from `today`.
    const daysSinceAnki = Math.floor((new Date() - new Date(completion.lastAnkiLogDate)) / DAY_MS);
    if (daysSinceAnki >= 3) urgency += 8;
  }

  const trend = confidenceTrend(completion?.activityLog || []);
  if (trend.trend === "declining") urgency += 12;
  if (trend.trend === "stuck") urgency += 8;

  if (zone === "build" && struggling > 0) urgency += 5;
  if (zone === "crunch") {
    if (sessions === 0) urgency += 20;
    if (struggling > 0) urgency += 15;
  }
  if (zone === "critical") {
    if (sessions === 0) urgency += 50;
    if (struggling > 0) urgency += 40;
    if (struggling === 0 && sessions > 0) urgency += 10;
  }
  return urgency;
}

/** What to actually do with a lecture next, in App's priority order. */
export function recommendedSessionsFor({ sessions, tally, nextReview, today, lastScore }) {
  const { struggling, untested, total } = tally;
  const out = [];

  if (sessions === 0) {
    out.push({ type: "deepLearn", label: "🧠 First Deep Learn", reason: "Never studied", duration: 45 });
    out.push({ type: "anki", label: "📇 Unsuspend Anki Cards", reason: "First pass — unsuspend and review", duration: 20 });
  } else if (struggling > 0) {
    out.push({
      type: "quiz",
      label: "⚠ Quiz Weak Objectives",
      reason: `${struggling} struggling objective${struggling > 1 ? "s" : ""}`,
      duration: 20,
    });
  } else if (nextReview && nextReview <= today) {
    out.push({ type: "anki", label: "📇 Anki Review Due", reason: "Spaced rep due today", duration: 15 });
    if (lastScore < 80) {
      out.push({
        type: "quiz",
        label: "✅ Quiz Full Lecture",
        reason: `Last score ${lastScore}% — needs review`,
        duration: 20,
      });
    }
  } else if (untested > 0 && total > 0) {
    out.push({
      type: "quiz",
      label: "○ Quiz Untested Objectives",
      reason: `${untested} objectives not yet tested`,
      duration: 15,
    });
  }
  return out;
}

/**
 * Completion is the cross-surface activity ledger (manual review, Anki and
 * Study launches). Performance is older quiz-only history. They overlap for
 * some modern Study sessions, so use the larger count rather than adding them.
 */
export function lecturePassCount(performance, completion) {
  const performanceCount = Array.isArray(performance?.sessions) ? performance.sessions.length : 0;
  const activityCount = Array.isArray(completion?.activityLog)
    ? completion.activityLog.filter((activity) => activity?.activityType !== "pre_read").length
    : Number(completion?.sessionCount || 0);
  return Math.max(performanceCount, activityCount);
}

/**
 * Day-by-day plan to the exam: score every lecture, then fill each day in three
 * passes — lectures happening that day, spaced-rep due, then by urgency.
 */
export function generateDailySchedule(context) {
  const {
    blockId,
    lectures = [],
    objectives = [],
    completion = {},
    reviewedLectures = {},
    lecturePerformance = {},
    terms = [],
    weakConcepts = {},
  } = context;
  const examDate = context.examDate ?? context.examDates?.[blockId];
  if (!examDate) return null;

  const comprehensiveExamDate = context.examDates?.__comprehensive ?? null;

  const today = startOfDay(context.now ?? new Date());
  const exam = startOfDay(examDate);
  const daysLeft = daysBetween(today, exam);
  if (daysLeft <= 0) {
    return { schedule: [], daysLeft: 0, lecScores: [], upcoming: [], undated: [], needsBlockStart: false };
  }

  const zone = pressureZone(examDate, context.now).zone;

  const block =
    context.blockMeta ?? terms.flatMap((t) => t.blocks || []).find((b) => b.id === blockId) ?? null;
  const blockStart = block?.startDate ? startOfDay(block.startDate) : null;

  const _lecDates = lecDateMap(lectures);
  const lecScores = lectures.map((lec) => {
    const pairedDate = (!lec.lectureDate && !lec.date && lec.lectureType === "DLA" && lec.lectureNumber != null)
      ? (_lecDates[lec.lectureNumber] ?? null) : null;
    const { date: availableDate } = availableDateFor(lec, blockStart, pairedDate);
    const isAvailableToday = availableDate && availableDate <= today;
    const isFuture = availableDate && availableDate > today;
    const daysUntilAvailable = availableDate ? Math.max(0, daysBetween(today, availableDate)) : null;

    const perf = lecturePerformance[lec.id] ?? null;
    const lecObjs = objectivesForLecture(objectives, lec);
    const tally = statusTally(lecObjs);
    const avgBloom =
      tally.total > 0
        ? lecObjs.reduce((s, o) => s + (o.bloom_level ?? 2), 0) / tally.total
        : 2;

    const lastScore = perf?.lastScore ?? null;
    const confidence = perf?.confidenceLevel || "Low";
    const nextReview = perf?.nextReview ? new Date(perf.nextReview) : null;
    const lecCompletion = completion[`${lec.id}__${blockId}`] || null;
    const sessions = lecturePassCount(perf, lecCompletion);

    const isFullyMastered = tally.total > 0 && tally.mastered === tally.total;
    const lastSessionAt = lecCompletion?.lastActivityDate ?? perf?.sessions?.[0]?.at ?? null;
    const daysSinceLast = lastSessionAt ? Math.round((today - new Date(lastSessionAt)) / DAY_MS) : 999;
    const compDaysLeft = comprehensiveExamDate
      ? Math.max(0, daysBetween(today, startOfDay(comprehensiveExamDate)))
      : Infinity;
    const needsCompReview = isFullyMastered && comprehensiveExamDate && compDaysLeft < 30 && daysSinceLast > 14;

    const lecWeakConcepts = weakConceptsForLecture(weakConcepts, blockId, lec.id);
    const urgencyArgs = { tally, avgBloom, lastScore, confidence, sessions, nextReview, today,
      reviewed: !!reviewedLectures[`${lec.id}__${blockId}`], completion: lecCompletion, zone,
      weakConceptCount: lecWeakConcepts.length, hasLandmineWeakConcept: lecWeakConcepts.some(isLandmine) };
    const urgency = needsCompReview
      ? lectureUrgency(urgencyArgs) + 15
      : lectureUrgency(urgencyArgs);

    const recommendedSessions = needsCompReview
      ? [{ label: "Comprehensive review", reason: "Mastered — review before semester final" }]
      : recommendedSessionsFor({ sessions, tally, nextReview, today, lastScore });

    return {
      lec,
      urgency,
      ...tally,
      avgBloom,
      lastScore,
      confidence,
      nextReview,
      sessions,
      lastSessionAt,
      daysSinceLast: lastSessionAt ? daysSinceLast : null,
      needsCompReview,
      recommendedSessions,
      availableDate,
      isAvailableToday,
      isFuture,
      daysUntilAvailable,
      hasNoDate: !availableDate,
    };
  });

  lecScores.sort((a, b) => b.urgency - a.urgency);

  const schedule = [];
  const MAX_PER_DAY = zone === "crunch" ? 8 : 6;
  const scheduled = new Set();

  for (let d = 0; d < daysLeft; d++) {
    const date = new Date(today);
    date.setDate(today.getDate() + d);
    date.setHours(0, 0, 0, 0);
    const dateStr = date.toISOString().slice(0, 10);
    const dayTasks = [];

    // Pass 1 — the lecture actually happens today.
    for (const ls of lecScores) {
      if (dayTasks.length >= MAX_PER_DAY) break;
      if (scheduled.has(ls.lec.id) || !ls.availableDate) continue;
      if (ls.availableDate.toISOString().slice(0, 10) === dateStr) {
        dayTasks.push({ ...ls, dateStr, matchReason: "scheduled-day" });
        scheduled.add(ls.lec.id);
      }
    }

    // Pass 2 — spaced repetition due or overdue.
    for (const ls of lecScores) {
      if (dayTasks.length >= MAX_PER_DAY) break;
      if (scheduled.has(ls.lec.id)) continue;
      if (!ls.isAvailableToday && d === 0) continue;
      if (ls.availableDate > date) continue;

      const isOverdue = ls.nextReview && ls.nextReview < today;
      const isDue = ls.nextReview && ls.nextReview.toISOString().slice(0, 10) === dateStr;
      if (isOverdue || isDue) {
        dayTasks.push({ ...ls, dateStr, matchReason: "spaced-rep-due" });
        scheduled.add(ls.lec.id);
      }
    }

    // Pass 3 — spread the rest by urgency rank across the days remaining.
    // NOTE: `ls.availableDate > date` is false for a null availableDate, so a
    // dateless lecture never reaches this pass — which is why a block whose
    // lectures carry no dates produces an empty schedule (see the fixture note
    // for mrspx2sg9go). Reproduced, not fixed.
    for (const ls of lecScores) {
      if (dayTasks.length >= MAX_PER_DAY) break;
      if (scheduled.has(ls.lec.id)) continue;
      if (!ls.availableDate || ls.availableDate > date) continue;
      if (ls.recommendedSessions.length === 0) continue;

      const scheduleOnDay = Math.floor((lecScores.indexOf(ls) / lecScores.length) * daysLeft);
      if (scheduleOnDay <= d) {
        dayTasks.push({ ...ls, dateStr, matchReason: "urgency" });
        scheduled.add(ls.lec.id);
      }
    }

    if (dayTasks.length > 0) {
      schedule.push({
        date,
        dateStr,
        daysFromNow: d,
        dayLabel:
          d === 0
            ? "Today"
            : d === 1
              ? "Tomorrow"
              : date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }),
        tasks: dayTasks,
      });
    }
  }

  const upcoming = lecScores
    .filter((ls) => ls.lec.lectureDate && ls.isFuture)
    .sort((a, b) => a.availableDate - b.availableDate)
    .slice(0, 8);

  const undated = lecScores
    .filter((ls) => !ls.lec.lectureDate && !ls.lec.weekNumber && !ls.lec.dayOfWeek)
    .sort((a, b) => (a.lec.lectureNumber || 0) - (b.lec.lectureNumber || 0));

  const needsBlockStart = lecScores.some(
    (ls) => (ls.lec.weekNumber || ls.lec.dayOfWeek) && !ls.lec.lectureDate && !block?.startDate
  );

  return { schedule, daysLeft, lecScores, upcoming, undated, needsBlockStart };
}
