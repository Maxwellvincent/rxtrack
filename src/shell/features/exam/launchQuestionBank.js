import { restoreVisualChoices } from "../../../engine/visualChoiceLabels.js";
import {schoolQuestionIdentity} from './schoolSourceIdentity.js';
import * as questionFigures from "../../../stores/questionFigures.js";
import { questionReferencesVisual } from "../../../engine/questionVisual.js";
import { questionClarityIssues } from "../../../engine/questionClarity.js";
import { createSessionShape } from "../../../examSessions.js";
import { createExamSession } from "../../../supabase.js";
import { examDurationMs } from "./examTiming.js";
import { linkSourceLecture, prepareBankQuestionSet } from "./questionBankLinks.js";

function makeSessionId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `bank_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function validBankQuestion(question) {
  const letters = Object.keys(question?.choices || {});
  const choiceLetters = letters.filter((letter) => /^[A-H]$/i.test(letter)).map((letter) => letter.toUpperCase()).sort();
  const choicesContiguous = !choiceLetters.length || choiceLetters.every((letter, index) => letter === String.fromCharCode(65 + index));
  const needsImage = !!(question?.hasImage || question?.imageDependent || questionReferencesVisual(question?.stem));
  const hasImage = !!(question?.sourceImageUrl || question?.sourceImageDataUrl || question?.image?.url || typeof question?.image === "string");
  return !questionClarityIssues(question).includes("invalid_answer_choices") && !!question?.stem && letters.length >= 2 && choicesContiguous && letters.includes(question?.correct) && (!needsImage || hasImage);
}

export function prepareQuestionBankQuestions(questions, { blockId, filename, analysis = null, lectures = [] }) {
  const { questions: distinctQuestions } = prepareBankQuestionSet(questions || [], analysis);
  return distinctQuestions.map((sourceQuestion, index) => {
    const question = restoreVisualChoices(linkSourceLecture(sourceQuestion, lectures, blockId));
    return {
    ...question,
    questionKey:question.questionKey || question.poolId || schoolQuestionIdentity(question),
    questionId: `bank:${filename}:${question.id || question.num || "q"}:${index + 1}`,
    blockId,
    lectureId: ["user-confirmed", "evidence-verified", "source-label-matched", "content-matched"].includes(question.curriculumLinkStatus) ? question.lectureId || null : null,
    objectiveIds: ["user-confirmed", "evidence-verified"].includes(question.curriculumLinkStatus) ? question.objectiveIds || [] : [],
    source: question.sourceRepresentation === "answer-explanation-summary"
      ? "Explanation-based review (abbreviated prompt)" : "Original school question",
    sourceFile: filename,
    sourceType: "question-bank",
    };
  });
}

export async function launchQuestionBankSession(
  { userId, blockId, filename, questions, analysis = null, lectures = [], format = "exam" },
  deps = {}
) {
  const create = deps.createExamSession || createExamSession;
  const { questions: sourceQuestions, removedDuplicateCount } = prepareBankQuestionSet(questions || [], analysis);
  if (!sourceQuestions.length) return { ok: false, error: "This question bank is empty." };
  const figures = await (deps.loadFigures || questionFigures.load)(userId, filename);
  const withFigures = sourceQuestions.map(q => questionFigures.apply(q, figures));
  const held = withFigures.filter(q => q.sourceKeyReviewStatus === 'stem-mismatch' && !q.correct && q.sourceKeyCandidate);
  const heldSet = new Set(held);
  const eligible = withFigures.filter(q => !heldSet.has(q));
  if (!eligible.length && held.length) return {ok:false,error:'All questions in this bank are awaiting source-key review. No answers have been inferred.'};
  const invalidCount = eligible.filter((question) => !validBankQuestion(question)).length;
  if (invalidCount) {
    return {
      ok: false,
      error: `Cannot start: ${invalidCount} question${invalidCount === 1 ? " is" : "s are"} incomplete (stem, contiguous choices, keyed answer, or required figure missing). Re-import and verify the original before using this bank.`,
    };
  }

  const sessionId = makeSessionId();
  const prepared = prepareQuestionBankQuestions(eligible, { blockId, filename, analysis, lectures });
  const startedAt = format === "exam" ? Date.now() : null;
  const session = createSessionShape({
    sessionId,
    blockId,
    lectureIds: [...new Set(prepared.map(q => q.lectureId).filter(Boolean))],
    format,
    questions: prepared,
    startedAt,
    deadline: startedAt == null ? null : startedAt + examDurationMs(prepared.length),
    sourceType: "question-bank",
    sourceFile: filename,
  });
  if (held.length) session.sourceExclusions = held.map(q => ({id:q.id || null,section:q.sourceSection || '',number:q.sourceQuestionNumber || q.num || null,reason:'source-key-review'}));
  const result = await create(userId, session);
  if (!result?.ok) return { ok: false, error: result?.error || "Could not create the quiz session." };
  return { ok: true, sessionId, questionCount: prepared.length, heldForReviewCount: held.length, removedDuplicateCount, deadline: session.deadline };
}
