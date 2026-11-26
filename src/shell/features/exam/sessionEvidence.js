import {assistanceFields} from '../../../engine/practiceAssistance.js';
import {schoolQuestionIdentity} from './schoolSourceIdentity.js';
import { missContextForAnswer } from "../../../engine/learningLoop.js";
import { hasCurrentReasoningAudit } from "../../../engine/questionOrder.js";
import { classifyLeadIn } from "./questionReading.js";
import { coverAnswerEvidence } from "../../../engine/activeRecall.js";

/** One durable identity per answer, shared by checkpoints and final submission. */
export function sessionEvidenceEvent(session, question, answer) {
  const correct = answer.value === question.correct;
  return {
    ...assistanceFields(question),
    eventId: `exam:${session.sessionId}:${question.questionId}`,
    pendingLectureStats: session.status === "in_progress",
    source: session.purpose==='lecture-checkpoint' ? 'lecture-checkpoint' : question.sourceType === "question-bank" ? "school-practice" : "integrated-exam",
    sessionKey: session.sessionId,
    blockId: question.sourceBlockId || question.blockId || session.blockId,
    lectureId: question.lectureId || null, objectiveIds: question.objectiveIds || [],
    questionKey: question.questionKey || question.poolId || (question.sourceType==='question-bank' && question.stem ? schoolQuestionIdentity(question) : question.id || question.questionId),
    legacyQuestionKey: question.questionKey || question.poolId || question.id || question.questionId,
    objectiveFacetId:question.objectiveFacetId || null,objectivePartId:question.objectivePartId || null,sourceRelationshipIds:question.sourceRelationshipIds || [],relationshipSourceVersion:question.relationshipSourceVersion || null,
    atomKey: question.atomKey || null, sourceConceptKeys: question.sourceConceptKeys || [], objectiveFacet: question.objectiveFacet || null, correct, difficulty: question.difficulty || null,
    learningContext: missContextForAnswer(question,answer.value,correct,!!question.assistance?.used),
    misconception: correct ? null : "exam-error", responseMs: answer.responseMs ?? null,
    answerChanges: answer.answerChanges || 0, taskType: question.taskType || classifyLeadIn(question.stem),
    reasoningDepth: question.reasoningDepth || null, orderLevel: question.orderLevel || null,
    reasoningVerified: hasCurrentReasoningAudit(question),
    ...(question.crossLecture ? { crossLecture: true } : {}),
    ...(question.crossLecture && question.secondaryObjectiveIds?.length ? { secondaryObjectiveIds: question.secondaryObjectiveIds, secondaryLectureId: question.crossLecture.partnerLectureId || null } : {}),
    ...coverAnswerEvidence(question),
    ...(Number.isFinite(Number(answer.confidence)) ? { confidence: Number(answer.confidence) } : {}),
    questionNumber: session.questions.findIndex(q => q.questionId === question.questionId) + 1,
    at: answer.answeredAt || session.progressSavedAt || session.submittedAt || session.startedAt || Date.now(),
  };
}
