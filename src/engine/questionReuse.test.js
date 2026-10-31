import { expect, it } from "vitest";
import { hasCurrentReasoningAudit, REASONING_REVIEW_POLICY } from "./questionOrder.js";
import { hasReusableQuestionReview, isReusableForObjective, QUESTION_REUSE_REVIEW_POLICY } from "./questionReuse.js";

const current = () => ({ generationVersion: "v2", objectiveIds: ["o"], orderLevel: "second-order",
  reasoningAudit: { status: "verified", version: 2, reviewPolicy: REASONING_REVIEW_POLICY, orderLevel: "second-order", connectedChain: true, singleEndpoint: true, choiceShortcut: false },
  qualityAudit: { status: "approved", reviewPolicy: QUESTION_REUSE_REVIEW_POLICY, reviewedAt: "2026-10-31T12:00:00Z", semanticObjectiveAlignment: true, objectiveId: "o" },
});

it("separates new-set eligibility from historical reasoning evidence without mutating a record", () => {
  const old = current(); delete old.qualityAudit.reviewPolicy;
  const snapshot = JSON.stringify(old);
  expect(hasCurrentReasoningAudit(old)).toBe(true);
  expect(hasReusableQuestionReview(old)).toBe(false);
  expect(JSON.stringify(old)).toBe(snapshot);
  expect(hasReusableQuestionReview(current())).toBe(true);
});

it("requires the current review, explicit ownership and matching reasoning level for reuse", () => {
  for (const patch of [
    { generationVersion: "v1" }, { generationMode: "grounded-fallback" }, { orderLevel: "third-order" },
    { qualityAudit: { ...current().qualityAudit, status: "local-validated" } },
    { qualityAudit: { ...current().qualityAudit, semanticObjectiveAlignment: false } },
    { qualityAudit: { ...current().qualityAudit, objectiveId: "other" } },
    { qualityAudit: { ...current().qualityAudit, reviewedAt: null } },
    { reasoningAudit: { ...current().reasoningAudit, reviewPolicy: "older" } },
  ]) expect(hasReusableQuestionReview({ ...current(), ...patch })).toBe(false);
});

it("does not let school calibration bypass an assigned depth floor or a different objective", () => {
  const question = { ...current(), difficultyCalibration: "school" };
  expect(isReusableForObjective(question, { id: "o", _targetOrder: "second-order" })).toBe(true);
  expect(isReusableForObjective(question, { id: "o", _targetOrder: "third-order" })).toBe(false);
  expect(isReusableForObjective(question, { id: "other" })).toBe(false);
});
