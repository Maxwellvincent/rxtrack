import { describe, expect, it } from "vitest";
import { objectivesForWeakConcept, weakConceptsForLectureView } from "./lectureWeakConcepts.js";

const objectives = [{ id: "o1" }, { id: "o2" }];

describe("lecture weak concepts", () => {
  it("keeps only active concepts owned by the lecture and reports the latest result", () => {
    const rows = weakConceptsForLectureView({ b1: [
      { concept: "Basal ganglia output", blockId: "b1", linkedLecIds: ["l1"], objectiveIds: ["o1"], masteryLevel: "struggling", missCount: 3, totalAttempts: 5, lastMissed: "2026-11-15T10:00:00Z", lastCorrect: "2026-11-14T10:00:00Z" },
      { concept: "Other lecture", blockId: "b1", linkedLecIds: ["l2"], objectiveIds: ["o2"], masteryLevel: "struggling", missCount: 4, totalAttempts: 4 },
      { concept: "Resolved", blockId: "b1", linkedLecIds: ["l1"], objectiveIds: ["o2"], masteryLevel: "mastered", missCount: 1, totalAttempts: 5 },
    ] }, { blockId: "b1", lectureId: "l1", objectives });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ concept: "Basal ganglia output", misses: 3, correct: 2, attempts: 5, lastOutcome: "missed", objectiveIds: ["o1"] });
  });

  it("never targets a stale or foreign objective link", () => {
    const [row] = weakConceptsForLectureView({ b1: [
      { concept: "Pathway", blockId: "b1", linkedLecIds: ["l1"], objectiveIds: ["o1", "foreign"], masteryLevel: "developing", missCount: 1, totalAttempts: 3, lastCorrect: "2026-11-15T10:00:00Z" },
    ] }, { blockId: "b1", lectureId: "l1", objectives });
    expect(row).toMatchObject({ lastOutcome: "correct", objectiveIds: ["o1"] });
    expect(objectivesForWeakConcept(row, objectives)).toEqual([{ id: "o1" }]);
  });
});
