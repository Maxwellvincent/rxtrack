/**
 * SP1 T4.1 — schedule fixture probe. TEST-ONLY, DEV-FLAG-GATED, TEMPORARY.
 *
 * `buildStudySchedule` and `generateDailySchedule` live inside App.jsx and close
 * over a dozen pieces of App state, so the only place their real behaviour can
 * be observed is a running App. This captures, per block, the exact INPUT
 * context and the OUTPUT of both — the fixtures T4.2's pure
 * `src/shell/logic/schedule.js` has to reproduce before Today can flip.
 *
 * It is enabled only by `?probe=schedule` and installs nothing otherwise: no
 * production code path touches this. DELETE THIS FILE once T4.2's fixtures are
 * captured and asserted — the plan sanctions the probe only for that window.
 */

export const PROBE_FLAG = "schedule";

/** Probing is opt-in per page load, never sticky. */
export function probeEnabled(search = typeof window !== "undefined" ? window.location.search : "") {
  try {
    return new URLSearchParams(search).get("probe") === PROBE_FLAG;
  } catch {
    return false;
  }
}

const readJson = (key, fallback) => {
  try {
    return JSON.parse(localStorage.getItem(key) || "null") ?? fallback;
  } catch {
    return fallback;
  }
};

// ── Slimming ────────────────────────────────────────────────────────────────
// A raw capture is ~1.5MB per block, nearly all of it input echoed back inside
// the output (every task carried its full objective objects) plus weak concepts
// that neither schedule function reads. Fixtures keep only what the functions
// actually consume and every decision they produce, so they stay reviewable and
// committable — a diff on them means behaviour changed.

const objectiveFields = (o) => ({
  id: o?.id ?? null,
  linkedLecId: o?.linkedLecId ?? null,
  status: o?.status ?? null,
  bloom_level: o?.bloom_level ?? null,
});

const lectureFields = (l) => ({
  id: l?.id ?? null,
  blockId: l?.blockId ?? null,
  lectureTitle: l?.lectureTitle ?? null,
  fileName: l?.fileName ?? l?.filename ?? null,
  lectureType: l?.lectureType ?? null,
  lectureNumber: l?.lectureNumber ?? null,
  lectureDate: l?.lectureDate ?? null,
  weekNumber: l?.weekNumber ?? null,
  dayOfWeek: l?.dayOfWeek ?? null,
  mergedFrom: (l?.mergedFrom || []).map((m) => ({ id: m?.id ?? null })),
});

const perfFields = (p) => ({
  lastScore: p?.lastScore ?? null,
  confidenceLevel: p?.confidenceLevel ?? null,
  nextReview: p?.nextReview ?? null,
  sessions: (p?.sessions || []).map((s) => ({ score: s?.score ?? null })),
});

const completionFields = (c) => ({
  ankiCardsOverdue: c?.ankiCardsOverdue ?? 0,
  ankiCardCount: c?.ankiCardCount ?? 0,
  lastAnkiLogDate: c?.lastAnkiLogDate ?? null,
  activityLog: (c?.activityLog || []).map((a) => ({
    date: a?.date ?? null,
    type: a?.type ?? null,
    score: a?.score ?? null,
    confidence: a?.confidence ?? null,
  })),
});

const mapValues = (obj, fn) =>
  Object.fromEntries(Object.entries(obj || {}).map(([k, v]) => [k, fn(v)]));

const objectiveIds = (list) => (list || []).map((o) => o?.id ?? null);

/** Study-schedule output, minus the objective objects echoed into every item. */
function slimStudySchedule(result) {
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
        lectureTitle: i.lectureTitle,
        lectureType: i.lectureType,
        lectureNum: i.lectureNum,
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

/** Daily-schedule output: urgency, ordering and task shape, without the echo. */
function slimDailySchedule(result) {
  if (!result) return null;
  const slimTask = (t) => ({
    ...t,
    lec: undefined,
    lectureId: t?.lectureId ?? t?.lec?.id ?? null,
    objectives: undefined,
    objectiveIds: t?.objectives ? objectiveIds(t.objectives) : undefined,
  });

  return {
    daysLeft: result.daysLeft,
    needsBlockStart: result.needsBlockStart,
    schedule: (result.schedule || []).map((day) => ({
      ...day,
      tasks: (day.tasks || []).map(slimTask),
    })),
    lecScores: (result.lecScores || []).map((ls) => ({
      lectureId: ls.lec?.id ?? null,
      urgency: ls.urgency,
      struggling: ls.struggling,
      untested: ls.untested,
      mastered: ls.mastered,
      total: ls.total,
      avgBloom: ls.avgBloom,
      lastScore: ls.lastScore,
      confidence: ls.confidence,
      nextReview: ls.nextReview ? new Date(ls.nextReview).toISOString() : null,
      sessions: ls.sessions,
      availableDate: ls.availableDate ? new Date(ls.availableDate).toISOString() : null,
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
    })),
    upcoming: (result.upcoming || []).map((ls) => ls.lec?.id ?? null),
    undated: (result.undated || []).map((ls) => ls.lec?.id ?? null),
  };
}

/**
 * The ScheduleContext the plan specifies, resolved to DATA.
 *
 * `blockMeta` and `studyModeByLecture` are materialised here rather than left as
 * App callbacks precisely because T4.2 forbids an App closure leaking into the
 * "pure" module — the fixture has to pin down what those functions returned.
 */
export function captureContext(deps, blockId) {
  const {
    terms = [],
    lectures = [],
    examDates = {},
    performanceHistory = {},
    reviewedLectures = {},
    getBlockObjectives,
    getBlockLecs,
    resolveBlockMeta,
    detectStudyMode,
    getLecPerf,
    now = new Date(),
  } = deps;

  const blockMeta = resolveBlockMeta ? resolveBlockMeta(blockId) : null;
  const blockLectures = getBlockLecs ? getBlockLecs(lectures, blockMeta || { id: blockId }) : [];
  const objectives = getBlockObjectives ? getBlockObjectives(blockId) || [] : [];

  const studyModeByLecture = {};
  const lecturePerformance = {};
  for (const lecture of blockLectures) {
    const lectureObjectives = objectives.filter(
      (o) =>
        o.linkedLecId === lecture.id ||
        (lecture.mergedFrom || []).some((m) => m && m.id === o.linkedLecId)
    );
    if (detectStudyMode) studyModeByLecture[lecture.id] = detectStudyMode(lecture, lectureObjectives);
    if (getLecPerf) lecturePerformance[lecture.id] = getLecPerf(lecture, blockId) ?? null;
  }

  const weakConcepts = readJson("rxt-weak-concepts", {});

  return {
    blockId,
    now: now.toISOString(),
    terms: terms.map((t) => ({
      id: t?.id ?? null,
      blocks: (t?.blocks || []).map((b) => ({ id: b?.id ?? null, startDate: b?.startDate ?? null })),
    })),
    blockMeta,
    lectures: blockLectures.map(lectureFields),
    objectives: objectives.map(objectiveFields),
    examDates,
    examDate: examDates[blockId] ?? null,
    performance: mapValues(performanceHistory, perfFields),
    lecturePerformance: mapValues(lecturePerformance, (p) => (p ? perfFields(p) : null)),
    completion: mapValues(readJson("rxt-completion", {}), completionFields),
    reviewedLectures,
    // Neither schedule function reads weak concepts; the plan lists them in
    // ScheduleContext, so record their shape without the 700KB of payload.
    weakConcepts: { _summary: mapValues(weakConcepts, (list) => (list || []).length) },
    studyModeByLecture,
  };
}

/** Both schedules for one block, with the context that produced them. */
export function captureBlock(deps, blockId) {
  const context = captureContext(deps, blockId);
  const errors = {};

  let studySchedule = null;
  try {
    studySchedule = deps.buildStudySchedule?.(blockId) ?? null;
  } catch (e) {
    errors.buildStudySchedule = e?.message || String(e);
  }

  let dailySchedule = null;
  try {
    dailySchedule = deps.generateDailySchedule?.(blockId, context.examDate) ?? null;
  } catch (e) {
    errors.generateDailySchedule = e?.message || String(e);
  }

  return {
    context,
    output: {
      studySchedule: slimStudySchedule(studySchedule),
      dailySchedule: slimDailySchedule(dailySchedule),
    },
    errors,
  };
}

async function send(name, data) {
  const res = await fetch("/__fixture", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, data }),
  });
  return res.json();
}

/**
 * Install `window.__rxtScheduleProbe` when the flag is on.
 *
 * Usage in the browser:
 *   await __rxtScheduleProbe.captureAll()   // every block with an exam date
 *   await __rxtScheduleProbe.capture("msk") // one block
 */
export function installScheduleProbe(deps) {
  if (typeof window === "undefined" || !probeEnabled()) return false;

  window.__rxtScheduleProbe = {
    capture: async (blockId) => {
      const captured = captureBlock(deps, blockId);
      const written = await send(`schedule/${blockId}`, captured);
      return { blockId, written, errors: captured.errors };
    },
    captureAll: async () => {
      const ids = Object.keys(deps.examDates || {});
      const results = [];
      for (const blockId of ids) {
        results.push(await window.__rxtScheduleProbe.capture(blockId));
      }
      await send("schedule/_index", {
        capturedAt: new Date().toISOString(),
        blocks: ids,
        note: "SP1 T4.1 — recorded from App.jsx; T4.2's pure schedule.js must reproduce these outputs.",
      });
      return results;
    },
    inspect: (blockId) => captureBlock(deps, blockId),
  };

  console.info("[rxt] schedule probe installed — run __rxtScheduleProbe.captureAll()");
  return true;
}
