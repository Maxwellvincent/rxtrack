import {schoolQuestionIdentity} from './schoolSourceIdentity.js';
import { questionLearningContext } from "../../../engine/learningLoop.js";
import { hasCurrentReasoningAudit } from "../../../engine/questionOrder.js";
import { classifyLeadIn } from "./questionReading.js";

/** One durable identity per answer, shared by checkpoints and final submission. */
export function sessionEvidenceEvent(session, question, answer) {
  const correct = answer.value === question.correct;
  return {
    eventId: `exam:${session.sessionId}:${question.questionId}`,
    pendingLectureStats: session.status === "in_progress",
    source: question.sourceType === "question-bank" ? "school-practice" : "integrated-exam",
    sessionKey: session.sessionId,
    blockId: question.sourceBlockId || question.blockId || session.blockId,
    lectureId: question.lectureId || null, objectiveIds: question.objectiveIds || [],
    questionKey: question.questionKey || question.poolId || (question.sourceType==='question-bank' && question.stem ? schoolQuestionIdentity(question) : question.id || question.questionId),
    legacyQuestionKey: question.questionKey || question.poolId || question.id || question.questionId,
    atomKey: question.atomKey || null, correct, difficulty: question.difficulty || null,
    ...(!correct ? {learningContext: questionLearningContext(question, answer.value)} : {}),
    misconception: correct ? null : "exam-error", responseMs: answer.responseMs ?? null,
    answerChanges: answer.answerChanges || 0, taskType: question.taskType || classifyLeadIn(question.stem),
    reasoningDepth: question.reasoningDepth || null, orderLevel: question.orderLevel || null,
    reasoningVerified: hasCurrentReasoningAudit(question),
    questionNumber: session.questions.findIndex(q => q.questionId === question.questionId) + 1,
    at: answer.answeredAt || session.progressSavedAt || session.submittedAt || session.startedAt || Date.now(),
  };
}
