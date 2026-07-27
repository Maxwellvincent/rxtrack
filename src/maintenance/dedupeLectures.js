/**
 * One-shot duplicate-lecture cleanup, runnable from the browser console:
 *
 *   const m = await import("/src/maintenance/dedupeLectures.js");
 *   await m.runLectureDedupe({ userId, dryRun: true });
 *   await m.runLectureDedupe({ userId });
 *
 * The bug that produced the duplicates is fixed at the source (the upload path
 * now tombstones what it replaces, and the sync honours tombstones). This clears
 * what the old behaviour already left behind.
 */
import * as lecturesStore from "../stores/lectures.js";
import * as objectivesStore from "../stores/blockObjectives.js";
import { applyRelinks, planLectureDedupe } from "../stores/lectureDedupe.js";
import {
  deleteLectureFromCloud,
  fetchLectureContent,
  overwriteObjectivesInCloud,
  saveLectureAtoms,
} from "../supabase.js";

/**
 * What each copy is actually worth: how much lecture text it holds, and whether
 * it has atoms. Both come from the cloud doc — localStorage is chunk-light for
 * everything outside the active term, so a local-only look would rank blind.
 */
async function surveyLectures(lectures, userId) {
  const atomIds = new Set();
  const contentSizes = {};
  await Promise.all(
    (lectures || []).map(async (l) => {
      try {
        const content = await fetchLectureContent(userId, l.id);
        if (content?.atoms?.length) atomIds.add(l.id);
        contentSizes[l.id] = (content?.chunks || [])
          .map((c) => c?.markdown || c?.text || c?.content || "")
          .join("").length;
      } catch {
        contentSizes[l.id] = 0;
      }
    })
  );
  return { atomIds, contentSizes };
}

/** Record the drop locally so a later push/pull cannot resurrect it. */
function tombstone(lectures, droppedIds) {
  try {
    const raw = JSON.parse(localStorage.getItem("rxt-id-tombstones") || "[]");
    const list = Array.isArray(raw) ? raw : [];
    for (const id of droppedIds) {
      const lec = lectures.find((l) => l?.id === id);
      if (!lec) continue;
      list.push({
        oldId: id,
        blockId: lec.blockId,
        lectureType: lec.lectureType,
        lectureNumber: String(lec.lectureNumber),
        deletedAt: new Date().toISOString(),
      });
    }
    localStorage.setItem("rxt-id-tombstones", JSON.stringify(list.slice(-50)));
  } catch { /* tombstones are best-effort */ }
}

export async function runLectureDedupe({ userId, dryRun = false } = {}) {
  const lectures = lecturesStore.read(userId) || [];
  const objectives = objectivesStore.read(userId) || {};
  const { atomIds, contentSizes } = await surveyLectures(lectures, userId);
  const plan = planLectureDedupe(lectures, { objectives, atomIds, contentSizes });

  const report = {
    dryRun,
    lectures: { before: lectures.length, after: plan.lectures.length },
    groups: plan.groups.map((g) => ({
      ...g,
      keepChars: contentSizes[g.keep] ?? 0,
      dropChars: g.drop.map((id) => contentSizes[id] ?? 0),
    })),
    relinked: plan.relink.length,
    atomsCarried: 0,
    cloud: null,
  };
  if (dryRun || !plan.drop.length) return report;

  // Move atoms onto survivors BEFORE anything is deleted.
  for (const group of plan.groups) {
    if (!group.carryAtomsFrom) continue;
    try {
      const source = await fetchLectureContent(userId, group.carryAtomsFrom);
      if (source?.atoms?.length) {
        await saveLectureAtoms(userId, group.keep, source.atoms);
        report.atomsCarried += 1;
      }
    } catch { /* the survivor can be re-extracted */ }
  }

  tombstone(lectures, plan.drop);
  lecturesStore.write(userId, plan.lectures);

  const nextObjectives = applyRelinks(objectives, plan.relink);
  if (plan.relink.length) {
    objectivesStore.write(userId, nextObjectives);
  }

  const deleted = [];
  const errors = [];
  for (const id of plan.drop) {
    try {
      await deleteLectureFromCloud(userId, id);
      deleted.push(id);
    } catch (e) {
      errors.push({ id, message: e?.message || String(e) });
    }
  }

  // Relinked objectives have to be written authoritatively, or the merge on the
  // next push puts the old lecture id back on them.
  const objectivesCloud = plan.relink.length
    ? await overwriteObjectivesInCloud(userId, nextObjectives)
    : null;

  report.cloud = { deleted: deleted.length, errors, objectives: objectivesCloud };
  return report;
}
