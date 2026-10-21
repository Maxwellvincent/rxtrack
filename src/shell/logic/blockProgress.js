import { selectBlockObjectives, selectLectureObjectives, dedupeByText, supplementaryObjective } from "./objectives.js";
import { statusTally } from "./schedule.js";
import { objectivePracticePlan } from "../../engine/objectivePractice.js";

/** One display projection for the library, Today footer and Objectives command center. */
export function lectureProgressObjectives(objectives, evidence) {
  const practice = objectivePracticePlan(objectives, evidence);
  const rows = new Map(practice.rows.map(row => [String(row.id), row]));
  return objectives.map(objective => {
    const row = rows.get(String(objective.id));
    // A practiced sibling must not erase this objective's explicit review status.
    // An authoritative zero evidence entry still protects scoring exclusions.
    const hasJournalEntry = evidence?.objectives?.[objective.id] != null;
    const savedStatus = ["inprogress", "in_progress", "in progress"].includes(objective.status)
      ? "developing" : objective.status;
    const status = !row?.worked && !hasJournalEntry
      ? savedStatus || "untested"
      : row?.state === "ready" ? "mastered" : row?.state || "untested";
    return { ...objective, status };
  });
}

export function lectureProgressCounts(objectives, evidence) {
  return statusTally(lectureProgressObjectives(objectives, evidence));
}

export function blockProgressProjection({ blockId, lectures = [], objectives = {}, catalog: suppliedCatalog, evidence = {} }) {
  const catalog = suppliedCatalog || selectBlockObjectives(objectives, blockId);
  const identity = row => {
    const code = String(row.code || row.objectiveCode || "").replace(/\s/g, "").toLowerCase();
    return code ? `code:${code}` : `text:${String(row.objective || row.text || "").slice(0, 60).toLowerCase().replace(/\W/g, "")}`;
  };
  const counted = new Set();
  const linked = [];
  for (const lecture of lectures.filter(row => (!row.blockId || row.blockId === blockId) && !row.mergedInto && !supplementaryObjective(row))) {
    const rows = selectLectureObjectives(catalog, lecture, evidence).filter(row => !supplementaryObjective(row) && !counted.has(identity(row)));
    rows.forEach(row => counted.add(identity(row)));
    linked.push(...lectureProgressObjectives(rows, evidence).map(row => ({ ...row, linkedLecId: lecture.id })));
  }
  const unlinked = dedupeByText(catalog, evidence).filter(row => !counted.has(identity(row)));
  return { linked, unlinked, counts: { ...statusTally(linked), unlinked: unlinked.length } };
}

export function blockProgressCounts(args) {
  return blockProgressProjection(args).counts;
}
