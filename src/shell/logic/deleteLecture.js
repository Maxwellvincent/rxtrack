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
