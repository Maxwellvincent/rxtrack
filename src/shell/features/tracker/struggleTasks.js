/**
 * Pure logic for the Struggle Tracker panel — grouping, clustering, and
 * block-scoping — split out of StruggleTasks.jsx so it's testable without a
 * DOM.
 */
import { matchCategoryToLecture } from "../../logic/examReportWeakConcepts.js";

export const STATE_RANK = { persistent: 3, deep: 2, watch: 1, "": 0 };

/**
 * A synced Anki task carries no RXTrack blockId — only a deck path / lecture
 * label string (e.g. "ER Lecture-10: Introduction to the Anatomy of the
 * Pelvis and Perineum"). Match it to the active block's own lecture titles by
 * word overlap, same technique the exam-report weak-concept matcher uses.
 * A lower threshold than that matcher's default compensates for how much
 * noisier/longer a raw deck path is than a clean exam category name.
 */
export function taskBelongsToBlock(task, lectures, threshold = 0.25) {
  if (!lectures?.length) return false;
  const label = task?.lecture || task?.deck || task?.concept || "";
  return !!matchCategoryToLecture(label, lectures, threshold);
}

export function filterTasksToBlock(tasks, lectures, threshold = 0.25) {
  return (tasks || []).filter((t) => taskBelongsToBlock(t, lectures, threshold));
}

/**
 * Cluster sibling cards into one row. Image-occlusion notes export one card
 * per masked region and share a `noteId`, but a duplicate concept can also
 * arrive as several separately-created notes (no shared noteId, near-
 * identical AI-written descriptions) — those still need to collapse, so the
 * fallback key is the concept name + lecture, not just noteId.
 */
export function clusterTasks(tasks) {
  const byKey = new Map();
  for (const t of tasks) {
    const key = t.noteId || `${(t.concept || "").trim().toLowerCase()}|${(t.lecture || t.deck || "").trim().toLowerCase()}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(t);
  }
  return [...byKey.values()].map((group) =>
    group.length === 1 ? { kind: "single", task: group[0] } : { kind: "group", tasks: group }
  );
}

/** Subject -> [rawCount, rows], worst-loaded subject first. */
export function groupStruggleTasks(tasks, { showDone = false } = {}) {
  const visible = (tasks || []).filter((t) => showDone || !t.doneLocally);
  visible.sort((a, b) => (STATE_RANK[b.state] || 0) - (STATE_RANK[a.state] || 0));

  const bySubject = new Map();
  for (const t of visible) {
    const key = t.subject || "Unclassified";
    if (!bySubject.has(key)) bySubject.set(key, []);
    bySubject.get(key).push(t);
  }

  const grouped = [...bySubject.entries()].map(([subject, items]) => [subject, items.length, clusterTasks(items)]);
  return grouped.sort((a, b) => b[1] - a[1]);
}
