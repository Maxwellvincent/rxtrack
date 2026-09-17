import * as lecturesStore from "../../stores/lectures.js";
import { saveLectureToCloud } from "../../supabase.js";

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Persist one lecture's calendar date to Firestore before updating the local
 * mirror. A local-only edit is overwritten by the next sign-in pull, which is
 * why date changes previously appeared to switch back by themselves.
 */
export async function updateLectureDate(userId, lectureId, date, deps = {}) {
  const store = deps.store || lecturesStore;
  const save = deps.save || saveLectureToCloud;
  const lecture = (store.read(userId) || []).find((item) => item?.id === lectureId);
  if (!lecture) throw new Error("Lecture not found. Refresh and try again.");

  const lectureDate = date ? String(date).slice(0, 10) : null;
  if (lectureDate && !DATE_ONLY.test(lectureDate)) throw new Error("Choose a valid lecture date.");

  const updated = { ...lecture, lectureDate };
  if (userId) {
    // Metadata-only write: changing a date must not re-upload a large active
    // lecture's page chunks just because they happen to be in the local row.
    const result = await save(userId, {
      id: lecture.id,
      blockId: lecture.blockId,
      termId: lecture.termId,
      lectureDate,
    });
    if (!result?.saved) throw new Error("Could not save the lecture date. Please retry.");
  }

  store.write(userId, (store.read(userId) || []).map((item) =>
    item?.id === lectureId ? updated : item
  ));
  return updated;
}
