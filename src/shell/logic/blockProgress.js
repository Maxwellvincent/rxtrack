import { selectBlockObjectives, selectLectureObjectives, dedupeByText } from "./objectives.js";
import { evidenceAwareObjectives, statusTally } from "./schedule.js";
import { objectivePracticePlan } from "../../engine/objectivePractice.js";

/** Same mutually exclusive states used by the lecture library; never rewrite source data. */
export function lectureProgressCounts(objectives, evidence) {
  const practice = objectivePracticePlan(objectives, evidence);
  return practice.worked > 0
    ? { total: practice.rows.length, mastered: practice.ready, inprogress: practice.developing, struggling: practice.struggling, untested: practice.untested }
    : statusTally(evidenceAwareObjectives(objectives, evidence));
}

export function blockProgressCounts({ blockId, lectures = [], objectives = {}, evidence = {} }) {
  const catalog = dedupeByText(selectBlockObjectives(objectives, blockId), evidence);
  const counts = { total: 0, mastered: 0, inprogress: 0, struggling: 0, untested: 0, unlinked: 0 };
  const counted = new Set();
  for (const lecture of lectures.filter(row => row.blockId === blockId && !row.mergedInto)) {
    const rows = selectLectureObjectives(catalog, lecture, evidence).filter(row => !counted.has(row));
    rows.forEach(row => counted.add(row));
    const tally = lectureProgressCounts(rows, evidence);
    for (const key of ["total", "mastered", "inprogress", "struggling", "untested"]) counts[key] += tally[key] || 0;
  }
  counts.unlinked = catalog.filter(row => !counted.has(row)).length;
  return counts;
}
