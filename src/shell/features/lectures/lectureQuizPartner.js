// Cross-lecture items inside a lecture quiz. Once every objective of this
// lecture has had a first pass, about a fifth of a quiz joins it with an
// EARLIER lecture of the same block, so recall has to cross lectures the way
// IMCQ and ESoft items do. Before the first pass there is no second half to
// connect, so the quiz stays single-lecture.

import { crossLecturePartners, partnerSignals } from "../exam/crossLecture.js";
import { loadExamLectureEvidence } from "../exam/lectureEvidence.js";

export const LECTURE_QUIZ_CROSS_SHARE = 0.2;

const dateOf = lecture => String(lecture?.lectureDate || lecture?.date || "");
const numberOf = lecture => {
  const value = Number(lecture?.lectureNumber);
  return Number.isFinite(value) ? value : null;
};

/** Lectures taught before `lecture` in the same block that have objectives. */
export function earlierBlockLectures(lecture, lectures = [], objectivesByLecture = {}) {
  if (!lecture?.id) return [];
  const ownDate = dateOf(lecture), ownNumber = numberOf(lecture), ownWeek = Number(lecture.weekNumber);
  return (lectures || []).filter(other => {
    if (!other?.id || other.id === lecture.id || other.mergedInto) return false;
    if (lecture.blockId && other.blockId !== lecture.blockId) return false;
    if (!(objectivesByLecture[other.id] || []).length) return false;
    const date = dateOf(other);
    if (ownDate && date) return date < ownDate || (date === ownDate && numberOf(other) !== null && ownNumber !== null && numberOf(other) < ownNumber);
    if (Number.isFinite(ownWeek) && Number.isFinite(Number(other.weekNumber)) && Number(other.weekNumber) !== ownWeek) return Number(other.weekNumber) < ownWeek;
    return ownNumber !== null && numberOf(other) !== null && numberOf(other) < ownNumber;
  });
}

/** Group block objectives by their linked lecture. */
export function objectivesByLinkedLecture(objectives = []) {
  const grouped = {};
  for (const objective of objectives || []) {
    const id = objective?.linkedLecId;
    if (!id) continue;
    (grouped[id] ||= []).push(objective);
  }
  return grouped;
}

/**
 * The partner for this quiz, with its text and objectives, or null when the
 * first pass is not done, no earlier lecture qualifies or its text is missing.
 */
export async function lectureQuizPartner({ userId, lecture, lectures = [], blockObjectives = [], firstPassComplete = false,
  termIndex = null, schoolQuestions = [], evidenceObjectives = {} } = {}, { loadEvidence = loadExamLectureEvidence, fetchContent } = {}) {
  if (!firstPassComplete || !lecture?.id) return null;
  const objectivesByLecture = objectivesByLinkedLecture(blockObjectives);
  const candidates = earlierBlockLectures({ ...lecture, blockId: lecture.blockId }, lectures, objectivesByLecture);
  if (!candidates.length) return null;
  const byId = Object.fromEntries([lecture, ...candidates].map(item => [item.id, item]));
  const signals = partnerSignals({ termIndex, schoolQuestions, objectivesByLecture, evidenceObjectives });
  const partnerId = crossLecturePartners([lecture.id], byId, { candidateIds: candidates.map(item => item.id), window: "scope", signals }).get(lecture.id);
  const partner = partnerId ? byId[partnerId] : null;
  if (!partner) return null;
  try {
    const loaded = await loadEvidence(partner, [], { userId, fetchContent });
    if (!loaded?.lectureText?.trim()) return null;
    return { id: partner.id, title: partner.lectureTitle || partner.fileName || partner.id, text: loaded.lectureText, objectives: objectivesByLecture[partner.id] || [] };
  } catch {
    return null;
  }
}
