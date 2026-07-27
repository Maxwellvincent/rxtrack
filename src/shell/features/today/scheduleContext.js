/**
 * SP1 T4.3 — assemble the ScheduleContext the pure schedulers consume.
 *
 * This is the piece App used to do implicitly through closures: filter lectures
 * to the block, dedupe objectives, resolve block metadata, and pre-compute the
 * per-lecture study mode and performance lookups. Doing it here keeps
 * `schedule.js` free of App and makes the whole input inspectable.
 */
import { dedupeByText, selectBlockObjectives } from "../../logic/objectives.js";
import { detectStudyMode } from "../../logic/studyMode.js";
import { objectivesForLecture } from "../../logic/schedule.js";

/** Block record from the terms tree — the resolved `blockMeta`. */
export function resolveBlockMeta(terms, blockId) {
  if (!blockId) return null;
  for (const term of terms || []) {
    const block = (term.blocks || []).find((b) => b?.id === blockId);
    if (block) return block;
  }
  return null;
}

/**
 * App's getLecPerf, which the daily scheduler reads per lecture: exact key
 * first, then any older key belonging to the same lecture, and never a fall
 * back to lecture number — a re-upload has to start clean.
 */
export function lecturePerformanceFor(performance, lectureId, blockId) {
  const history = performance || {};
  const exact = lectureId ? `${lectureId}__${blockId}` : `block__${blockId}`;
  if (history[exact]) return history[exact];
  if (!lectureId) return null;
  const byId = Object.keys(history).find((k) => k.startsWith(`${lectureId}__`));
  return byId ? history[byId] : null;
}

/**
 * @param {object} stores raw store data straight off the hooks
 * @returns {object} ScheduleContext — data only, no callbacks
 */
export function buildScheduleContext({
  blockId,
  terms = [],
  lectures = [],
  objectives = {},
  performance = {},
  completion = {},
  examDates = {},
  reviewedLectures = {},
  weakConcepts = {},
  now = new Date(),
}) {
  const blockLectures = (lectures || []).filter((l) => l?.blockId === blockId);
  // Same de-dupe the objectives UI applies, so Today counts what the tracker shows.
  const blockObjectives = dedupeByText(selectBlockObjectives(objectives, blockId));

  const studyModeByLecture = {};
  const lecturePerformance = {};
  for (const lecture of blockLectures) {
    studyModeByLecture[lecture.id] = detectStudyMode(
      lecture,
      objectivesForLecture(blockObjectives, lecture)
    );
    lecturePerformance[lecture.id] = lecturePerformanceFor(performance, lecture.id, blockId);
  }

  return {
    blockId,
    now: now instanceof Date ? now.toISOString() : now,
    terms,
    blockMeta: resolveBlockMeta(terms, blockId),
    lectures: blockLectures,
    objectives: blockObjectives,
    examDates,
    examDate: examDates?.[blockId] ?? null,
    performance,
    lecturePerformance,
    completion,
    reviewedLectures,
    weakConcepts,
    studyModeByLecture,
  };
}
