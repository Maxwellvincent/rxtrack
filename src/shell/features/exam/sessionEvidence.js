import {assistanceFields} from '../../../engine/practiceAssistance.js';
import {schoolQuestionIdentity} from './schoolSourceIdentity.js';
import { questionLearningContext } from "../../../engine/learningLoop.js";
import { hasCurrentReasoningAudit } from "../../../engine/questionOrder.js";
import { classifyLeadIn } from "./questionReading.js";

/** One durable identity per answer, shared by checkpoints and final submission. */
export function sessionEvidenceEvent(session, question, answer) {
  const correct = answer.value === question.correct;
  return {
    ...assistanceFields(question),
    eventId: `exam:${session.sessionId}:${question.questionId}`,
    pendingLectureStats: session.status === "in_progress",
    source: question.sourceType === "question-bank" ? "school-practice" : "integrated-exam",
    sessionKey: session.sessionId,
    blockId: question.sourceBlockId || question.blockId || session.blockId,
    lectureId: question.lectureId || null, objectiveIds: question.objectiveIds || [],
    questionKey: question.questionKey || question.poolId || (question.sourceType==='question-bank' && question.stem ? schoolQuestionIdentity(question) : question.id || question.questionId),
    legacyQuestionKey: question.questionKey || question.poolId || question.id || question.questionId,
    objectiveFacetId:question.objectiveFacetId || null,sourceRelationshipIds:question.sourceRelationshipIds || [],relationshipSourceVersion:question.relationshipSourceVersion || null,
    atomKey: question.atomKey || null, sourceConceptKeys: question.sourceConceptKeys || [], objectiveFacet: question.objectiveFacet || null, correct, difficulty: question.difficulty || null,
    learningContext: !correct||question.assistance?.used?questionLearningContext(question,answer.value):{topic:questionLearningContext(question,answer.value).topic},
    misconception: correct ? null : "exam-error", responseMs: answer.responseMs ?? null,
    answerChanges: answer.answerChanges || 0, taskType: question.taskType || classifyLeadIn(question.stem),
    reasoningDepth: question.reasoningDepth || null, orderLevel: question.orderLevel || null,
    reasoningVerified: hasCurrentReasoningAudit(question),
    questionNumber: session.questions.findIndex(q => q.questionId === question.questionId) + 1,
    at: answer.answeredAt || session.progressSavedAt || session.submittedAt || session.startedAt || Date.now(),
  };
}
