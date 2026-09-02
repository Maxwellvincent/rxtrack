import { describe, expect, it } from "vitest";
import { blockReadinessSummary, readinessTrend } from "./blockReadiness.js";

describe("block readiness", () => {
  it("combines coverage, practice, model due state and ranked study targets", () => {
    const now = Date.parse("2026-09-02T12:00:00Z");
    const result = blockReadinessSummary({
      blockId: "dm",
      lectures: [
        { id: "a", blockId: "dm", lectureTitle: "Carbohydrates" },
        { id: "b", blockId: "dm", lectureTitle: "Autonomics" },
      ],
      objectives: [
        { id: "o1", linkedLecId: "a", status: "struggling" },
        { id: "o2", linkedLecId: "a", status: "untested" },
        { id: "o3", linkedLecId: "b", status: "mastered" },
      ],
      questionStats: { a: { answered: 10, correct: 5 }, b: { answered: 5, correct: 5 } },
      confidenceRecords: [
        ...Array.from({ length: 20 }, (_, i) => ({ confidence: 4, correct: i < 10 })),
        ...Array.from({ length: 20 }, (_, i) => ({ confidence: 4, correct: i < 16 })),
      ],
      models: [{ id: "m", blockId: "dm", lectureId: "a", status: "Shaky", nextReviewAt: now - 1 }],
      weakConcepts: [{ linkedLecIds: ["a"] }],
      now,
    });
    expect(result.objectives.coverage).toBeCloseTo(2 / 3);
    expect(result.practice.answered).toBe(15);
    expect(result.models.overdue).toBe(1);
    expect(result.targets[0].lectureId).toBe("a");
    expect(result.targets[0].reasons).toContain("flagged by exam review");
    expect(result.trend.direction).toBe("up");
  });

  it("does not invent a trend from a tiny sample", () => {
    expect(readinessTrend([{ correct: true }]).label).toBe("Building baseline");
  });

  it("does not inflate readiness with duplicate objective records", () => {
    const result = blockReadinessSummary({
      blockId: "dm",
      lectures: [{ id: "a", blockId: "dm", lectureTitle: "Carbohydrates" }],
      objectives: [
        { id: "old", code: "SOM.DM.0001", objective: "Describe glycolysis.", linkedLecId: "a", status: "untested" },
        { id: "new", objectiveCode: "SOM.DM.0001", text: "Describe glycolysis.", linkedLecId: "a", status: "untested" },
      ],
    });

    expect(result.objectives.total).toBe(1);
    expect(result.targets[0].untested).toBe(1);
  });
});
