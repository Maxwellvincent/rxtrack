/**
 * SP1 T4.4 — the block's full lecture list.
 *
 * Today shows the six most urgent lectures; this is the rest of Tracker's
 * day-to-day surface: every lecture with its coverage, last activity and
 * urgency, filterable. The scoring is already done — `generateDailySchedule`
 * ranks every lecture in the block — so this only projects and filters.
 */

import {
  availableDateFor,
  lectureUrgency,
  objectivesForLecture,
  pressureZone,
  recommendedSessionsFor,
  statusTally,
} from "../../logic/schedule.js";

export const FILTERS = ["all", "struggling", "untested", "unstarted", "done"];

/**
 * Score every lecture in the block, independently of whether the exam is still
 * ahead.
 *
 * `generateDailySchedule` early-returns an empty result once the exam has
 * passed — correct for scheduling, useless for a list, and it made this surface
 * show "0 lectures" for every finished block. This reuses the same exported
 * primitives (same urgency formula, same tallies), so where both produce rows
 * they agree.
 */
export function scoreLectures(context) {
  const { blockId, lectures = [], objectives = [], completion = {}, reviewedLectures = {}, lecturePerformance = {} } = context || {};
  const now = context?.now ? new Date(context.now) : new Date();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  const examDate = context?.examDate ?? null;
  // No exam, or one already gone: score without pressure inflation.
  const zone = examDate ? pressureZone(examDate, now).zone : "normal";
  const blockStart = context?.blockMeta?.startDate ? new Date(context.blockMeta.startDate) : null;
  if (blockStart) blockStart.setHours(0, 0, 0, 0);

  return lectures.map((lec) => {
    const lecObjs = objectivesForLecture(objectives, lec);
    const tally = statusTally(lecObjs);
    const perf = lecturePerformance[lec.id] ?? null;
    const sessions = perf?.sessions?.length || 0;
    const lastScore = perf?.lastScore ?? null;
    const confidence = perf?.confidenceLevel || "Low";
    const nextReview = perf?.nextReview ? new Date(perf.nextReview) : null;
    const avgBloom =
      tally.total > 0 ? lecObjs.reduce((s, o) => s + (o.bloom_level ?? 2), 0) / tally.total : 2;
    const { date: availableDate } = availableDateFor(lec, blockStart);

    return {
      lec,
      ...tally,
      avgBloom,
      sessions,
      lastScore,
      confidence,
      nextReview,
      availableDate,
      isFuture: !!(availableDate && availableDate > today),
      hasNoDate: !availableDate,
      urgency: lectureUrgency({
        tally,
        avgBloom,
        lastScore,
        confidence,
        sessions,
        nextReview,
        today,
        reviewed: !!reviewedLectures[`${lec.id}__${blockId}`],
        completion: completion[`${lec.id}__${blockId}`] || null,
        zone,
      }),
      recommendedSessions: recommendedSessionsFor({ sessions, tally, nextReview, today, lastScore }),
      studyMode: context?.studyModeByLecture?.[lec.id] ?? null,
    };
  });
}

/** One row per lecture, from the daily scheduler's lecScores. */
export function lectureRow(score, { completion = {}, blockId } = {}) {
  const lecture = score.lec || {};
  const entry = completion[`${lecture.id}__${blockId}`] || null;
  const done = score.total > 0 && score.mastered === score.total;

  return {
    lectureId: lecture.id,
    // `subject` before giving up: this data has nameless import stubs that still
    // carry objectives, and "Untitled lecture" repeated 13 times tells you nothing.
    title:
      lecture.lectureTitle ||
      lecture.fileName ||
      lecture.filename ||
      (lecture.subject ? `${lecture.subject} (unnamed)` : "Untitled lecture"),
    type: lecture.lectureType || "LEC",
    number: lecture.lectureNumber ?? null,
    urgency: score.urgency,
    struggling: score.struggling,
    untested: score.untested,
    mastered: score.mastered,
    total: score.total,
    coverage: score.total > 0 ? Math.round((score.mastered / score.total) * 100) : null,
    sessions: score.sessions,
    lastScore: score.lastScore,
    confidence: score.confidence,
    lastActivityDate: entry?.lastActivityDate ?? null,
    lastConfidence: entry?.lastConfidence ?? null,
    nextReview: entry?.reviewDates?.[0] ?? null,
    ankiInRotation: !!entry?.ankiInRotation,
    availableDate: score.availableDate ?? null,
    weekNumber: lecture.weekNumber ?? null,
    dayOfWeek: lecture.dayOfWeek ?? null,
    isFuture: !!score.isFuture,
    hasNoDate: !!score.hasNoDate,
    recommendedSessions: score.recommendedSessions || [],
    studyMode: score.studyMode ?? null,
    done,
  };
}

export function matchesFilter(row, filter) {
  switch (filter) {
    case "struggling":
      return row.struggling > 0;
    case "untested":
      return row.untested > 0;
    case "unstarted":
      return row.sessions === 0;
    case "done":
      return row.done;
    default:
      return true;
  }
}

export function matchesSearch(row, search) {
  const q = String(search || "").trim().toLowerCase();
  if (!q) return true;
  return `${row.type} ${row.number ?? ""} ${row.title}`.toLowerCase().includes(q);
}

export const SORTS = {
  // Default: the same ranking Today uses, so the two surfaces agree.
  urgency: (a, b) => b.urgency - a.urgency,
  lecture: (a, b) => (a.number ?? Infinity) - (b.number ?? Infinity) || a.title.localeCompare(b.title),
  coverage: (a, b) => (a.coverage ?? -1) - (b.coverage ?? -1),
  recent: (a, b) => String(b.lastActivityDate || "").localeCompare(String(a.lastActivityDate || "")),
};

export function buildLectureRows(scores, { completion, blockId, filter = "all", search = "", sort = "urgency" } = {}) {
  const rows = (scores || [])
    .map((score) => lectureRow(score, { completion, blockId }))
    .filter((row) => matchesFilter(row, filter) && matchesSearch(row, search));

  return [...rows].sort(SORTS[sort] || SORTS.urgency);
}

/** Counts for the filter chips — computed over everything, not the filtered view. */
export function lectureCounts(scores, { completion, blockId } = {}) {
  const rows = (scores || []).map((score) => lectureRow(score, { completion, blockId }));
  return {
    all: rows.length,
    struggling: rows.filter((r) => matchesFilter(r, "struggling")).length,
    untested: rows.filter((r) => matchesFilter(r, "untested")).length,
    unstarted: rows.filter((r) => matchesFilter(r, "unstarted")).length,
    done: rows.filter((r) => matchesFilter(r, "done")).length,
  };
}
