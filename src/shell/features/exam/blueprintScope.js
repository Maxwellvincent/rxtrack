import { blockProgressProjection } from "../../logic/blockProgress.js";
import { formatLectureLabel } from "../../../lectureTitle.js";

/** Subject weights never broaden a block exam's curriculum scope. CBSE owns cross-block practice. */
export function blockBlueprintContext(blockId, lectures = [], objectiveStore = {}, evidence = {}) {
  const scoped = lectures.filter(lecture => lecture?.blockId === blockId && !lecture.mergedInto);
  const catalog = blockProgressProjection({blockId, lectures: scoped, objectives: objectiveStore, evidence}).linked;
  const objectivesByLecture = {};
  for (const lecture of scoped) {
    const objectives = catalog.filter(objective => objective.linkedLecId === lecture.id);
    if (objectives.length) objectivesByLecture[lecture.id] = objectives;
  }
  return {
    lectures: scoped,
    lecturesById: Object.fromEntries(scoped.map(lecture => [lecture.id, lecture])),
    atomsByLecture: Object.fromEntries(scoped.map(lecture => [lecture.id, Array.isArray(lecture.atoms) ? lecture.atoms : []])),
    objectivesByLecture,
    eligibleLectures: scoped.filter(lecture => objectivesByLecture[lecture.id]?.length).map(lecture => ({ lectureId: lecture.id, blockId, lectureLabel: formatLectureLabel(lecture), objectiveCount: objectivesByLecture[lecture.id].length })),
  };
}

/** Mixed banks are filtered per question; matching anatomy alone is not scope evidence. */
export function blockBlueprintBanks(banks = [], blockId, lectures = []) {
  if (!blockId) return banks;
  const ids = new Set(lectures.filter(lecture => lecture.blockId === blockId).map(lecture => lecture.id));
  return banks.map(bank => ({ ...bank, questions: (bank.questions || []).filter(question => {
    if (question.blockId && question.blockId !== blockId) return false;
    if (question.lectureId) return ids.has(question.lectureId);
    return question.blockId === blockId || bank.blockId === blockId;
  }) })).filter(bank => bank.questions.length);
}
