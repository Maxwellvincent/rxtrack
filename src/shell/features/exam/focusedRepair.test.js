import { describe, expect, it } from "vitest";
import { buildFocusedRepairScope, objectiveRepairEvidence, repairTaskForIndex } from "./focusedRepair.js";

const lectures = [
  { lectureId: "l1", lectureLabel: "Pituitary" },
  { lectureId: "l2", lectureLabel: "Histology" },
];
const objectivesByLecture = {
  l1: [{ id: "o1", objective: "Explain pituitary signaling", status: "struggling" }],
  l2: [{ id: "o2", objective: "Recognize ovarian histology", status: "untested" }],
};

describe("focused repair", () => {
  it("prioritizes weak objectives and keeps untested objectives available", () => {
    const scope = buildFocusedRepairScope({
      eligibleLectures: lectures,
      objectivesByLecture,
      blockId: "b1",
      weakConcepts: { b1: [{ concept: "pituitary", blockId: "b1", objectiveIds: ["o1"], linkedLecIds: ["l1"] }] },
      learnerEvidence: { objectives: { o1: { attempts: 2, correct: 0, recent: [false, false] } } },
    });
    expect(scope.eligibleLectures.map((lecture) => lecture.lectureId)).toEqual(["l1", "l2"]);
    expect(scope.objectivesByLecture.l1[0].repairPriority).toBeGreaterThan(scope.objectivesByLecture.l2[0].repairPriority);
  });

  it("clears an objective only after five fresh answers meet the 78 percent target", () => {
    expect(objectiveRepairEvidence({ recent: [true, true, true, true] }).cleared).toBe(false);
    expect(objectiveRepairEvidence({ recent: [true, true, true, true, false] }).cleared).toBe(true);
    expect(objectiveRepairEvidence({ recent: [true, true, true, false, false] }).cleared).toBe(false);
    const scope = buildFocusedRepairScope({
      eligibleLectures: [lectures[0]], objectivesByLecture: { l1: objectivesByLecture.l1 }, blockId: "b1",
      weakConcepts: { b1: [{ concept: "pituitary", blockId: "b1", objectiveIds: ["o1"], linkedLecIds: ["l1"] }] },
      learnerEvidence: { objectives: { o1: { recent: [true, true, true, true, false] } } },
    });
    expect(scope.objectiveCount).toBe(0);
  });

  it("cycles from recognition through a fresh transfer retest", () => {
    expect(Array.from({ length: 5 }, (_, index) => repairTaskForIndex(index))).toEqual([
      "recognition", "mechanism", "clinical-application", "fresh-retest", "recognition",
    ]);
  });
});
