// Delete a whole block: its lectures, its objectives and its entry in the term
// list. Study history (exam sessions, answer evidence) is not deleted — it is
// keyed by question and objective ids and simply stops being shown.
import * as termsStore from "../../stores/terms.js";
import * as lecturesStore from "../../stores/lectures.js";
import * as objectivesStore from "../../stores/blockObjectives.js";
import { deleteLectureFromCloud, fetchLectureContent } from "../../firebaseData.js";
import { flattenEntry, readEntry } from "./objectives.js";

/** What deleting `blockId` would remove, without touching anything. */
export function planBlockDeletion({ blockId, terms = [], lectures = [], objectives = {} } = {}) {
  const term = (terms || []).find((item) => (item.blocks || []).some((block) => block?.id === blockId)) || null;
  const block = term?.blocks.find((item) => item.id === blockId) || null;
  const blockLectures = (lectures || []).filter((lecture) => lecture?.blockId === blockId);
  const blockObjectives = flattenEntry(readEntry(objectives, blockId));
  return {
    block,
    termId: term?.id || null,
    lectureIds: blockLectures.map((lecture) => lecture.id).filter(Boolean),
    lectureCount: blockLectures.length,
    objectiveCount: blockObjectives.length,
    objectivesWithAttempts: blockObjectives.filter((objective) => Number(objective?.attempts || objective?.totalAttempts) > 0).length,
  };
}

/** The term list with `blockId` removed. */
export function termsWithoutBlock(terms = [], blockId) {
  return (terms || []).map((term) => ((term.blocks || []).some((block) => block?.id === blockId)
    ? { ...term, blocks: term.blocks.filter((block) => block?.id !== blockId) }
    : term));
}

/** Everything the block holds, for the backup file downloaded before deleting. */
export async function blockBackup({ userId, blockId, terms, lectures, objectives }, { fetchContent = fetchLectureContent } = {}) {
  const plan = planBlockDeletion({ blockId, terms, lectures, objectives });
  const blockLectures = (lectures || []).filter((lecture) => lecture?.blockId === blockId);
  const withContent = [];
  for (const lecture of blockLectures) {
    let content = null;
    try { content = userId ? await fetchContent(userId, lecture.id) : null; } catch { content = null; }
    withContent.push({ ...lecture, ...(content ? { chunks: content.chunks, atoms: content.atoms, images: content.images } : {}) });
  }
  return {
    kind: "rxtrack-block-backup",
    version: 1,
    exportedAt: new Date().toISOString(),
    termId: plan.termId,
    block: plan.block,
    objectives: readEntry(objectives, blockId),
    lectures: withContent,
  };
}

/**
 * Delete the block. Order matters: lectures and objectives go first, the term
 * entry last, so a failure part-way leaves the block visible to retry.
 */
export async function deleteBlock({ userId, blockId }, deps = {}) {
  const terms = deps.terms || termsStore;
  const lectures = deps.lectures || lecturesStore;
  const objectives = deps.objectives || objectivesStore;
  const deleteLecture = deps.deleteLecture || deleteLectureFromCloud;
  if (!userId || !blockId) throw new Error("Sign in and choose a block first.");
  const currentLectures = lectures.read(userId) || [];
  const plan = planBlockDeletion({ blockId, terms: terms.read(userId) || [], lectures: currentLectures, objectives: objectives.read(userId) || {} });
  if (!plan.block) throw new Error("That block is no longer in your term list.");

  const failed = [];
  for (const lectureId of plan.lectureIds) {
    try { await deleteLecture(userId, lectureId); } catch (error) { failed.push(`${lectureId}: ${error?.message || error}`); }
  }
  const gone = new Set(plan.lectureIds.filter((id) => !failed.some((line) => line.startsWith(`${id}:`))));
  lectures.write(userId, currentLectures.filter((lecture) => !gone.has(lecture?.id)));
  if (failed.length) throw new Error(`${failed.length} lecture(s) could not be deleted; the block was kept so you can retry. ${failed[0]}`);

  await objectives.removeBlock(userId, blockId);
  await terms.writeAwait(userId, termsWithoutBlock(terms.read(userId) || [], blockId));
  return plan;
}
