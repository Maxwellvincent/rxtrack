import { describe, expect, it } from "vitest";
import { buildQuizBenchmark, formatOptionMix } from "./quizBenchmark.js";

describe("quiz benchmark", () => {
  it("compares form structure and only objective-linked performance across both sets", () => {
    const result = buildQuizBenchmark({
      filename: "ESoftQuiz2-DM-Report.pdf",
      questions: [
        { id: "q1", stem: "A patient has lab results and an image. Which finding?", choices: { A: "a", B: "b", C: "c", D: "d", E: "e" }, hasImage: true, sourceAttemptCorrect: false },
        { id: "q2", stem: "Another patient asks for the mechanism.", choices: { A: "a", B: "b" }, sourceAttemptCorrect: true },
      ],
      analysis: { items: [{ id: "q1", objectiveIds: ["o1"], objectiveBasis: "candidate-overlap" }, { id: "q2", objectiveIds: ["o1"] }], sourcePerformance: { count: 2, correct: 1, accuracy: 50 } },
    }, {
      title: "Week 4 Quiz",
      questions: [{ questionId: "g1", stem: "A fasting patient has laboratory results. Which change?", choices: { A: "a", B: "b", C: "c", D: "d", E: "e" }, correct: "A", objectiveIds: ["o1"] }],
      answers: [{ questionId: "g1", value: "A" }],
    }, [{ id: "o1", objective: "Explain pathway regulation." }]);

    expect(result).toMatchObject({
      sourcePerformance: { count: 2, correct: 1, accuracy: 50 },
      appPerformance: { correct: 1, count: 1, accuracy: 100 },
      objectiveCrosswalkBasis: "candidate-overlap",
    });
    expect(result.sourceMetrics.optionCounts).toEqual({ 2: 1, 5: 1 });
    expect(result.sourceMetrics.visualCount).toBe(1);
    expect(result.sharedObjectives[0]).toMatchObject({ label: "Explain pathway regulation.", source: { attempts: 2, correct: 1 }, app: { attempts: 1, correct: 1 } });
    expect(formatOptionMix(result.sourceMetrics.optionCounts)).toBe("2 options: 1 · 5 options: 1");
  });
});
