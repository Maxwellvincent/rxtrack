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

  it("counts a linked question attempt as objective exposure without calling it mastery", () => {
    const result = blockReadinessSummary({
      blockId: "dm",
      lectures: [{ id: "a", blockId: "dm", lectureTitle: "Carbohydrates" }],
      objectives: [
        { id: "o1", linkedLecId: "a", status: "untested" },
        { id: "o2", linkedLecId: "a", status: "untested" },
      ],
      learnerEvidence: { objectives: { o1: { attempts: 1, recent: [true] } } },
    });
    expect(result.objectives).toMatchObject({ total: 2, covered: 1, inprogress: 1, untested: 1 });
    expect(result.objectives.coverage).toBe(0.5);
    expect(result.objectives.mastered).toBe(0);
  });

  it("surfaces a linked incorrect attempt as struggling exposure", () => {
    const result = blockReadinessSummary({
      blockId: "dm", lectures: [{ id: "a", blockId: "dm" }], objectives: [{ id: "o1", linkedLecId: "a", status: "untested" }],
      learnerEvidence: { objectives: { o1: { attempts: 1, recent: [false] } } },
    });
    expect(result.objectives).toMatchObject({ covered: 1, struggling: 1, untested: 0 });
  });

  it("excludes unlinked curriculum objectives from readiness and completion", () => {
    const result = blockReadinessSummary({
      blockId: "dm",
      lectures: [{ id: "lec-1", blockId: "dm", lectureTitle: "GI anatomy" }],
      objectives: [
        { id: "linked", linkedLecId: "lec-1", status: "mastered" },
        { id: "sg", activity: "SG", lectureHint: "DM Anatomy", status: "untested" },
      ],
    });

    expect(result.objectives).toMatchObject({ total: 1, covered: 1, mastered: 1, untested: 0, coverage: 1 });
  });
});
