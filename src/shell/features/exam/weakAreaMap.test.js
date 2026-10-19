import { describe, expect, it } from "vitest";
import { buildWeakAreaMap } from "./weakAreaMap.js";

describe("buildWeakAreaMap", () => {
  it("ranks demonstrated weaknesses ahead of objective gaps and combines all saved lecture practice totals", () => {
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

    expect(rows.map((row) => row.lectureId)).toEqual(["weak", "gap", "covered"]);
    expect(rows[1]).toMatchObject({ totalQuestions: 0, accuracy: null, objectiveTotal: 2, objectivesTested: 0, objectivesUntested: 2 });
    expect(rows[0]).toMatchObject({ totalQuestions: 5, correct: 1, misses: 4, accuracy: 0.2, objectivesUntested: 0, strugglingObjectives: 1 });
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

it("uses recent retests for priority without erasing lifetime accuracy or report signals", () => {
 const rows = buildWeakAreaMap({ lectures: [{ id: "improving" }, { id: "weak" }, { id: "report" }],
 questionStats: { improving: { answered: 30, correct: 9 }, weak: { answered: 5, correct: 1 } },
 learnerEvidence: { lectures: { improving: { recent: [true,true,true,true] }, weak: { recent: [false,false,true] } } },
 reportWeaknesses: [{ concept: "Reported pathway weakness", linkedLecIds: ["report"], tags: ["exam-report"], masteryLevel: "struggling" }] });
 expect(rows.map(r=>r.lectureId)).toEqual(["weak","report","improving"]);
 expect(rows[2]).toMatchObject({ accuracy: .3, recentAccuracy: 1, priorityAccuracy: 1 });
 expect(rows[1].reportTopics).toEqual(["Reported pathway weakness"]);
 expect(rows[1].totalQuestions).toBe(0);
});
