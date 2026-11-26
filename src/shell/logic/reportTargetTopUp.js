// Keep a score-report category stocked with generated questions. Category
// practice draws about 40% of a 20-question set from generated questions
// (8). When fewer unused ones remain on the category's lectures, generate the
// shortfall in the background with the same objective-first pipeline lecture
// study uses, aimed at the category's objectives, and save them to the
// lecture's generated-question store for the next set.

import * as generatedStore from "../../stores/generatedQuestions.js";
import * as lecturesStore from "../../stores/lectures.js";
import * as objectivesStore from "../../stores/blockObjectives.js";
import * as banksStore from "../../stores/questionBanks.js";
import * as metaStore from "../../stores/questionBankMeta.js";
import * as sourceUseStore from "../../stores/sourceUse.js";
import { flattenObjectiveEntry } from "../data.js";
import { getLecText } from "../../lectureText.js";
import { isValidPoolQuestion } from "../../questionPool.js";

export const GENERATED_TARGET = 8;
const MAX_LECTURES = 2;
const normStem = stem => String(stem || "").toLowerCase().replace(/\s+/g, " ").trim();

/** Unused generated questions saved for these lectures, shaped for a session. */
export function storedGeneratedForLectures(userId, lectureIds = [], deps = {}) {
  const forLecture = deps.questionsForLecture || generatedStore.questionsForLecture;
  const unseen = deps.isQuestionUnseen || generatedStore.isQuestionUnseen;
  return [...new Set(lectureIds)].flatMap(lectureId => (forLecture(userId, lectureId) || [])
    .filter(question => unseen(question) && isValidPoolQuestion(question))
    .map(question => ({ ...question, lectureId: question.lectureId || lectureId, sourceKind: "generated", generatedStore: true,
      questionId: question.questionId || `gen:${lectureId}:${normStem(question.stem).slice(0, 80)}` })));
}

/** Objectives a top-up aims at on one lecture: the category's, else the lecture's. */
export function topUpObjectives(lectureObjectives = [], targetObjectiveIds = []) {
  const wanted = new Set(targetObjectiveIds);
  const hits = lectureObjectives.filter(objective => wanted.has(objective.id));
  return hits.length ? hits : lectureObjectives;
}

/**
 * Generate up to `GENERATED_TARGET - have` questions for a category, split
 * over its first lectures. Resolves `{ added, errors }`; never throws.
 */
export async function topUpCategoryQuestions({ userId, target, have = 0, onProgress = () => {} }, deps = {}) {
  const needed = GENERATED_TARGET - have;
  if (!userId || !target || target.broad || needed <= 0) return { added: 0, errors: [] };
  const lectures = (deps.lectures || lecturesStore.read(userId) || []).filter(lecture => target.lectureIds.includes(lecture.id)).slice(0, MAX_LECTURES);
  if (!lectures.length) return { added: 0, errors: [] };
  const objectivesByBlock = deps.objectivesByBlock || objectivesStore.read(userId) || {};
  const banks = deps.banks || banksStore.read(userId) || {};
  const meta = deps.meta || metaStore.read(userId) || {};
  const sourceUse = deps.sourceUse || sourceUseStore.read(userId);
  const quizLaunch = deps.quizLaunch || await import("../features/objectives/quizLaunch.js");
  const fetchContent = deps.fetchLectureContent || (await import("../../firebaseData.js")).fetchLectureContent;
  const preparation = deps.preparationDeps || await (await import("../../questionPreparation.js")).questionPreparationDeps((await import("../../aiClient.js")).callAIJSON);
  const ensureObjectiveParts = deps.ensureObjectiveParts || (await import("../features/objectives/objectivePartsLoader.js")).ensureObjectiveParts;
  const addQuestions = deps.addQuestions || generatedStore.addQuestions;
  const history = (deps.questionsForAllLectures || generatedStore.questionsForAllLectures)(userId) || [];

  let added = 0;
  const errors = [];
  const perLecture = Math.ceil(needed / lectures.length);
  for (const lecture of lectures) {
    if (added >= needed) break;
    const objectives = topUpObjectives(flattenObjectiveEntry(objectivesByBlock[lecture.blockId]).filter(objective => objective?.linkedLecId === lecture.id), target.objectiveIds);
    if (!objectives.length) continue;
    const count = Math.min(perLecture, needed - added);
    const title = lecture.lectureTitle || lecture.fileName || "Lecture";
    onProgress({ lectureTitle: title, count, added });
    try {
      const content = await fetchContent(userId, lecture.id).catch(() => null);
      const withText = { ...lecture, chunks: content?.chunks || lecture.chunks || [] };
      await quizLaunch.prepareObjectiveQuiz({
        objectives, lectureTitle: title, lectureText: getLecText(withText), lectureIdHint: lecture.id, blockId: lecture.blockId,
        atoms: content?.atoms || lecture.atoms || [], userId, difficulty: "medium", generationVersion: "v2", questionCount: count,
        exemplars: quizLaunch.selectExemplarsForBlock(banks, meta, lecture.blockId, sourceUse),
        avoidStems: history.map(question => question.stem).filter(Boolean), avoidQuestions: history,
        focusNotes: `Score-report weak area: ${target.keywords?.slice(0, 8).join(", ") || ""}`,
      }, {
        ...preparation, ensureObjectiveParts, maxPrepareAttempts: 1, maxPreparationMs: 120000, prepareConcurrency: 1,
        onAccepted: batch => { added += batch.length; addQuestions(userId, lecture.id, batch); },
      });
    } catch (problem) { errors.push(`${title}: ${problem?.message || problem}`); }
  }
  return { added, errors };
}
