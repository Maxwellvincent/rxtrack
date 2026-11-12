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

  it("keeps review-only ratings separate from question coverage", () => {
    const [row] = buildWeakAreaMap({
      lectures: [{ id: "l1", lectureTitle: "Lec 1" }],
      objectives: [
        { id: "a", linkedLecId: "l1", status: "mastered" },
        { id: "b", linkedLecId: "l1", status: "untested" },
      ],
    });
    expect(row).toMatchObject({ objectivesTested: 0, objectivesUntested: 2, accuracy: null, totalQuestions: 0 });
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
it('replaces a stale eight-answer weakness with the complete latest quiz log',()=>{
 const [r]=buildWeakAreaMap({lectures:[{id:'retina'}],questionStats:{retina:{answered:39,correct:27,recentAnswers:Array.from({length:20},(_,i)=>({correct:i<17,at:1000+i}))}},learnerEvidence:{lectures:{retina:{lastSeen:1019,recent:[true,false,false,false,false,false,true,false]}}}});
 expect(r).toMatchObject({recentCount:20,recentAccuracy:.85,priorityAccuracy:.85,totalQuestions:39});
});
it('does not substitute assisted raw totals for missing independent priority evidence',()=>{
 const [row]=buildWeakAreaMap({lectures:[{id:'l'}],questionStats:{l:{answered:10,correct:10,hasAssistedAnswers:true}},learnerEvidence:{lectures:{}}});
 expect(row.accuracy).toBe(1);expect(row.priorityAccuracy).toBeNull();
});
it('recognizes assisted lecture evidence even before stats reconciliation has added a marker',()=>{
 const [row]=buildWeakAreaMap({lectures:[{id:'l'}],questionStats:{l:{answered:20,correct:20}},learnerEvidence:{assistedJournal:[{lectureId:'l',assisted:true,correct:true}],lectures:{}}});
 expect(row.hasAssistedAnswers).toBe(true);expect(row.priorityAccuracy).toBeNull();
});
