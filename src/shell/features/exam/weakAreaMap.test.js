import { describe, expect, it } from "vitest";
import { buildWeakAreaMap } from "./weakAreaMap.js";

describe("buildWeakAreaMap", () => {
  it("ranks objective gaps first and combines all saved lecture practice totals", () => {
    const rows = buildWeakAreaMap({
      lectures: [
        { id: "covered", lectureTitle: "Covered lecture" },
        { id: "gap", lectureTitle: "Untested lecture" },
        { id: "weak", lectureTitle: "Low accuracy lecture" },
      ],
      objectives: [
        { id: "a", linkedLecId: "covered", status: "untested" },
        { id: "b", linkedLecId: "gap", status: "untested" },
        { id: "c", linkedLecId: "gap", status: "untested" },
        { id: "d", linkedLecId: "weak", status: "untested" },
      ],
      learnerEvidence: { objectives: { a: { attempts: 1, recent: [true] }, d: { attempts: 1, recent: [false] } } },
      questionStats: {
        covered: { answered: 4, correct: 4 },
        weak: { answered: 5, correct: 1 },
      },
    });

    expect(rows.map((row) => row.lectureId)).toEqual(["gap", "weak", "covered"]);
    expect(rows[0]).toMatchObject({ totalQuestions: 0, accuracy: null, objectiveTotal: 2, objectivesTested: 0, objectivesUntested: 2 });
    expect(rows[1]).toMatchObject({ totalQuestions: 5, correct: 1, misses: 4, accuracy: 0.2, objectivesUntested: 0, strugglingObjectives: 1 });
  });

  it("counts explicitly rated objectives as seen and tolerates missing lecture metrics", () => {
    const [row] = buildWeakAreaMap({
      lectures: [{ id: "l1", lectureTitle: "Lec 1" }],
      objectives: [
        { id: "a", linkedLecId: "l1", status: "mastered" },
        { id: "b", linkedLecId: "l1", status: "untested" },
      ],
    });
    expect(row).toMatchObject({ objectivesTested: 1, objectivesUntested: 1, accuracy: null, totalQuestions: 0 });
  });
});
