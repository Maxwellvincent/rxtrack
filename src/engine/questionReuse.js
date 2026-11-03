import {answerRouteIssue} from './questionAnswerRoute.js';
import {QUESTION_REVIEW_POLICY,questionAdmissionIssues} from './questionContract.js';
import { verifiedDiscrimination } from "./questionDiscrimination.js";
import { hasCurrentReasoningAudit, normalizeQuestionOrder, REASONING_REVIEW_POLICY } from "./questionOrder.js";

export const QUESTION_REUSE_REVIEW_POLICY = QUESTION_REVIEW_POLICY;

/** Eligibility for a NEW generated set, never a rewrite of historical evidence. */
export function hasReusableQuestionReview(question = {}) {
  if(questionAdmissionIssues(question).length)return false;
  const quality = question.qualityAudit;
  if (question.generationVersion !== "v2" || question.generationMode === "grounded-fallback") return false;
  if (!hasCurrentReasoningAudit(question) || question.reasoningAudit.reviewPolicy !== REASONING_REVIEW_POLICY) return false;
  if (!normalizeQuestionOrder(question.orderLevel) || normalizeQuestionOrder(question.orderLevel) !== normalizeQuestionOrder(question.reasoningAudit.orderLevel)) return false;
  if (!quality || quality.reviewPolicy !== QUESTION_REUSE_REVIEW_POLICY
    || !["approved", "approved-with-notes"].includes(quality.status) || !Number.isFinite(Date.parse(quality.reviewedAt))) return false;
  if (!verifiedDiscrimination(quality.discrimination, question)) return false;
  if (quality.blindSolve?.status !== "matched" || quality.blindSolve.answer !== question.correct || !quality.blindSolve.sourceQuotes?.some(q=>typeof q==="string" && q.trim().length>=16)) return false;
  if(answerRouteIssue(quality.blindSolve.answerRoute,question,{requireReasoningAudit:true}))return false;
  const ids = question.objectiveIds || [];
  return ids.length === 0 || (ids.length === 1 && quality.semanticObjectiveAlignment === true && quality.objectiveId === ids[0]);
}

export function isReusableForObjective(question, objective) {
  if (!hasReusableQuestionReview(question) || !question.objectiveIds?.includes(objective?.id || objective?.code)) return false;
  const target = normalizeQuestionOrder(objective._targetOrder);
  const order = normalizeQuestionOrder(question.orderLevel);
  return !!order && (!target || ["first-order", "second-order", "third-order"].indexOf(order) >= ["first-order", "second-order", "third-order"].indexOf(target));
}
