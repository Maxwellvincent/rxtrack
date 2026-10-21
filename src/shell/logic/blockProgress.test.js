import { expect, it } from "vitest";
import { blockProgressCounts, lectureProgressCounts } from "./blockProgress.js";
const lecture = { id: "nb13", blockId: "NB", lectureNumber: 13, lectureType: "LEC" };
const one = { id: "one", code: "SOM.MKII.BPM2.1.NB.1.ANAT.1", objective: "Identify the nerve", linkedLecId: "nb13", status: "untested" };
it("counts linked curriculum once, keeps unlinked separate and excludes other blocks", () => {
 const counts = blockProgressCounts({ blockId: "NB", lectures: [lecture, { id: "dm", blockId: "DM" }], objectives: { NB: { imported: [one, { ...one, id: "duplicate" }, { id: "unlinked", objective: "Unlinked objective" }], extracted: [{ id: "two", objective: "Describe a pathway", linkedLecId: "nb13", status: "mastered" }] }, DM: [one] } });
 expect(counts).toEqual({ total: 2, mastered: 0, inprogress: 0, struggling: 0, untested: 2, unlinked: 1 });
});
it("recognizes practice from the practiced duplicate identity rather than the first import", () => {
 const evidence = { objectives: { practiced: { attempts: 1, correct: 1, recent: [true] } } };
 const counts = blockProgressCounts({ blockId: "NB", lectures: [lecture], objectives: { NB: [one, { ...one, id: "practiced" }] }, evidence });
 expect(counts.total).toBe(1); expect(counts.untested).toBe(0); expect(counts.inprogress).toBe(1);
 expect(counts.mastered + counts.inprogress + counts.struggling + counts.untested).toBe(counts.total);
});
it("agrees with the lecture calculation without equating review labels with answered questions", () => {
 const objectives = [{ ...one, status: "mastered" }, { id: "two", objective: "Second", linkedLecId: lecture.id, status: "in_progress" }];
 const counts = blockProgressCounts({ blockId: "NB", lectures: [lecture], objectives: { NB: objectives } });
 expect(counts).toMatchObject(lectureProgressCounts(objectives, {}));
 expect(counts.mastered).toBe(0); expect(counts.inprogress).toBe(0); expect(counts.untested).toBe(2);
});
it("credits a ready objective even when the stored status still says untested", () => {
 const evidence = { objectives: { one: { attempts: 3, correct: 3, recent: [true, true, true], sessions: ["a", "b"], taskTypes: { recall: 1, application: 2 } } } };
 const counts = blockProgressCounts({ blockId: "NB", lectures: [lecture], objectives: { NB: [one] }, evidence });
 expect(counts).toMatchObject({ total: 1, mastered: 1, untested: 0 });
 expect(one.status).toBe("untested");
});
it("does not let an invalid earlier duplicate hide a valid lecture link", () => {
 const objectives = [{ ...one, id: "invalid", lectureNumber: 99 }, { ...one, lectureNumber: 13 }];
 const counts = blockProgressCounts({ blockId: "NB", lectures: [lecture], objectives: { NB: objectives } });
 expect(counts).toMatchObject({ total: 1, unlinked: 0 });
});
it("keeps linked lab and small-group sources out of lecture totals and priorities", () => {
 const catalog = [one, { id: "lab", objective: "Lab structures", activity: "LAB 2", linkedLecId: lecture.id, status: "struggling" }, { id: "sg", objective: "Small group", activity: "SG 1", linkedLecId: lecture.id }];
 const counts = blockProgressCounts({ blockId: "NB", lectures: [lecture], objectives: { NB: catalog } });
 expect(counts).toMatchObject({ total: 1, struggling: 0, untested: 1, unlinked: 2 });
});

it("does not credit an untouched sibling merely because it was marked reviewed", () => {
 const objectives = [one, { id: "reviewed", objective: "Reviewed separately", linkedLecId: lecture.id, status: "in_progress" }];
 const evidence = { objectives: { one: { attempts: 1, correct: 1, recent: [true] } } };
 const counts = blockProgressCounts({ blockId: "NB", lectures: [lecture], objectives: { NB: objectives }, evidence });
 expect(counts).toMatchObject({ total: 2, inprogress: 1, untested: 1 });
});
it("keeps an excluded-only objective untested despite a saved completion label", () => {
 const objectives = [one, { id: "excluded", objective: "Excluded question", linkedLecId: lecture.id, status: "mastered" }];
 const evidence = { objectives: { one: { attempts: 1, correct: 1 }, excluded: { attempts: 0, correct: 0 } } };
 expect(blockProgressCounts({ blockId: "NB", lectures: [lecture], objectives: { NB: objectives }, evidence })).toMatchObject({ total: 2, inprogress: 1, mastered: 0, untested: 1 });
});
