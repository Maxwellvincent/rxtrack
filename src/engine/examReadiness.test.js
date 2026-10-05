import { describe, expect, it } from "vitest";
import {
  BPM2_DM_BENCHMARK,
  answerQuality,
  comparePredictionToActual,
  computeEnduranceAnalytics,
  computeObjectiveMastery,
  computeSecondStepAccuracy,
  forecastExam,
} from "./examReadiness.js";

describe("post-exam readiness framework", () => {
  it("grades answer quality without treating lucky correctness as mastery", () => {
    expect(answerQuality({ correct: false, confidence: "confident" })).toBe(0);
    expect(answerQuality({ correct: true, confidence: "guess" })).toBe(1);
    expect(answerQuality({ correct: true, confidence: "unsure" })).toBe(2);
    expect(answerQuality({ correct: true, confidence: "confident", reasoningCorrect: true })).toBe(3);
  });

  it("measures the second step only after correct state identification", () => {
    expect(computeSecondStepAccuracy([
      { topicIdentified: true, masteryStage: "mechanism", correct: true, answerQuality: 3 },
      { topicIdentified: true, masteryStage: "application", correct: false, answerQuality: 0 },
      { topicIdentified: false, masteryStage: "mechanism", correct: true, answerQuality: 3 },
    ])).toEqual({ attempts: 2, correct: 1, accuracy: 0.5 });
  });

  it("requires mechanism, application/discrimination, delayed PROVE, variety, and no recurring error for Exam Ready", () => {
    const events = [
      { objectiveIds: ["o1"], correct: true, answerQuality: 3, masteryStage: "mechanism", taskType: "build-mechanism", sessionKey: "s1", at: 1 },
      { objectiveIds: ["o1"], correct: true, answerQuality: 3, masteryStage: "application", taskType: "break-application", sessionKey: "s1", at: 2 },
      { objectiveIds: ["o1"], correct: true, answerQuality: 3, masteryStage: "discrimination", taskType: "prove-discrimination", trainingPhase: "prove", delayMs: 86_400_000, sessionKey: "s2", at: 3 },
      { objectiveIds: ["o1"], correct: true, answerQuality: 3, masteryStage: "application", taskType: "prove-application", trainingPhase: "prove", delayMs: 172_800_000, sessionKey: "s2", at: 4 },
    ];
    expect(computeObjectiveMastery({ objectives: [{ id: "o1", text: "Apply the pathway" }], events })[0]).toMatchObject({
      stage: "stable", examReady: true, state: "strong", delayedRetrievals: 2,
    });
  });

  it("does not call quality-1 evidence ready", () => {
    const events = Array.from({ length: 5 }, (_, index) => ({
      objectiveIds: ["o1"], correct: true, answerQuality: 1, masteryStage: "application",
      taskType: index % 2 ? "break-application" : "prove-application", sessionKey: `s${index}`, at: index + 1,
    }));
    expect(computeObjectiveMastery({ objectives: [{ id: "o1" }], events })[0].examReady).toBe(false);
  });

  it("detects late-block accuracy decay", () => {
    const questions = Array.from({ length: 20 }, (_, index) => ({ questionId: `q${index}`, correct: "A" }));
    const answers = questions.map((question, index) => ({ questionId: question.questionId, value: index < 15 ? "A" : "B", responseMs: 60_000 }));
    const result = computeEnduranceAnalytics([{ questions, answers }]);
    expect(result.quarters[0].accuracy).toBe(1);
    expect(result.quarters[3].accuracy).toBe(0);
    expect(result.enduranceFlag).toBe(true);
  });

  it("keeps Benchmark #1 and calibrates future prediction comparisons", () => {
    expect(BPM2_DM_BENCHMARK).toMatchObject({ actualPercent: 65.38, date: "2026-09-30" });
    const compared = comparePredictionToActual([
      BPM2_DM_BENCHMARK,
      { id: "future", actualPercent: 82, predictedPercent: 79, predictedRange: [74, 84] },
    ]);
    expect(compared).toMatchObject({ count: 1, meanError: 3, meanAbsoluteError: 3 });
    expect(compared.rows[1].insideRange).toBe(true);
  });

  it("produces an honest range and ranks objective limiters", () => {
    const result = forecastExam({ objectiveRows: [
      { id: "strong", state: "strong", attempts: 5, qualityRate: 0.9 },
      { id: "weak", text: "Vitamin mechanisms", state: "weak", attempts: 3, qualityRate: 0.2, mechanismAccuracy: 0.3 },
      { id: "new", text: "Untested objective", state: "untested", attempts: 0 },
    ], sessions: [], secondStep: { accuracy: 0.5 }, endurance: { accuracyDrop: 0.2, enduranceFlag: true } });
    expect(result.range[0]).toBeLessThan(result.predictedPercent);
    expect(result.range[1]).toBeGreaterThan(result.predictedPercent);
    expect(result.primaryLimiter).not.toBeNull();
    expect(result.highestRoi[0].id).toBe("weak");
  });
});
