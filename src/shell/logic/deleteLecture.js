import * as lecturesStore from "../../stores/lectures.js";
import * as objectivesStore from "../../stores/blockObjectives.js";
import { addLectureTombstoneId, deleteLectureFromCloud, overwriteObjectivesInCloud } from "../../supabase.js";

/** Permanently delete one lecture while preserving imported curriculum objectives as unlinked. */
export async function deleteLectureFully({ userId, lectureId, blockId }, deps = {}) {
  if (!lectureId) throw new Error("No lecture selected.");
  const lectures = deps.lectures || lecturesStore;
  const objectives = deps.objectives || objectivesStore;
  const removeCloud = deps.deleteCloud || deleteLectureFromCloud;
  const tombstone = deps.tombstone || addLectureTombstoneId;
  const saveObjectives = deps.saveObjectives || overwriteObjectivesInCloud;

  if (userId) await removeCloud(userId, lectureId);
  tombstone(lectureId);
  lectures.write(userId, (lectures.read(userId) || []).filter((lecture) => lecture.id !== lectureId));

  const objectiveMap = objectives.read(userId) || {};
  const entry = objectiveMap[blockId];
  if (!entry) return true;
  let nextEntry;
  if (Array.isArray(entry)) {
    nextEntry = entry.map((o) => o?.linkedLecId === lectureId ? { ...o, linkedLecId: null, sourceFile: null } : o);
  } else {
    nextEntry = {
      ...entry,
      imported: (entry.imported || []).map((o) => o?.linkedLecId === lectureId ? { ...o, linkedLecId: null, sourceFile: null } : o),
      extracted: (entry.extracted || []).filter((o) => o?.linkedLecId !== lectureId),
    };
  }
  const nextMap = { ...objectiveMap, [blockId]: nextEntry };
  objectives.write(userId, nextMap);
  if (userId) await saveObjectives(userId, nextMap);
  return true;
}

/** Delete an explicitly selected set, continuing after individual cloud failures. */
export async function deleteLecturesFully({ userId, lectures = [], blockId, onProgress }, deps = {}) {
  const lectureStore = deps.lectures || lecturesStore;
  const objectiveStore = deps.objectives || objectivesStore;
  const removeCloud = deps.deleteCloud || deleteLectureFromCloud;
  const tombstone = deps.tombstone || addLectureTombstoneId;
  const saveObjectives = deps.saveObjectives || overwriteObjectivesInCloud;
  const deletedIds = [];
  const failures = [];
  for (const lecture of lectures) {
    if (!lecture?.id) continue;
    try {
      if (userId) await removeCloud(userId, lecture.id);
      deletedIds.push(lecture.id);
    } catch (error) {
      failures.push({ id: lecture.id, title: lecture.lectureTitle || lecture.title || "Lecture", error });
    } finally {
      onProgress?.(deletedIds.length + failures.length, lectures.length);
    }
  }

  if (!deletedIds.length) return { deletedIds, failures, objectivesSaved: true };
  deletedIds.forEach((id) => tombstone(id));
  const deleted = new Set(deletedIds);
  lectureStore.write(userId, (lectureStore.read(userId) || []).filter((lecture) => !deleted.has(lecture.id)));

  const objectiveMap = objectiveStore.read(userId) || {};
  const entry = objectiveMap[blockId];
  if (!entry) return { deletedIds, failures, objectivesSaved: true };
  const unlink = (objective) => deleted.has(objective?.linkedLecId)
    ? { ...objective, linkedLecId: null, sourceFile: null }
    : objective;
  const nextEntry = Array.isArray(entry)
    ? entry.map(unlink)
    : {
        ...entry,
        imported: (entry.imported || []).map(unlink),
        extracted: (entry.extracted || []).filter((objective) => !deleted.has(objective?.linkedLecId)),
      };
  const nextMap = { ...objectiveMap, [blockId]: nextEntry };
  objectiveStore.write(userId, nextMap);
  try {
    if (userId) await saveObjectives(userId, nextMap);
    return { deletedIds, failures, objectivesSaved: true };
  } catch (error) {
    return { deletedIds, failures, objectivesSaved: false, objectiveSaveError: error };
  }
}
