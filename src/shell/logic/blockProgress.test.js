import { expect, it } from "vitest";
import { blockProgressCounts, lectureProgressCounts } from "./blockProgress.js";
const lecture = { id: "nb13", blockId: "NB", lectureNumber: 13, lectureType: "LEC" };
const one = { id: "one", code: "SOM.MKII.BPM2.1.NB.1.ANAT.1", objective: "Identify the nerve", linkedLecId: "nb13", status: "untested" };
it("counts linked curriculum once, keeps unlinked separate and excludes other blocks", () => {
 const counts = blockProgressCounts({ blockId: "NB", lectures: [lecture, { id: "dm", blockId: "DM" }], objectives: { NB: { imported: [one, { ...one, id: "duplicate" }, { id: "unlinked", objective: "Unlinked objective" }], extracted: [{ id: "two", objective: "Describe a pathway", linkedLecId: "nb13", status: "mastered" }] }, DM: [one] } });
 expect(counts).toEqual({ total: 2, mastered: 1, inprogress: 0, struggling: 0, untested: 1, unlinked: 1 });
});
it("recognizes practice from the practiced duplicate identity rather than the first import", () => {
 const evidence = { objectives: { practiced: { attempts: 1, correct: 1, recent: [true] } } };
 const counts = blockProgressCounts({ blockId: "NB", lectures: [lecture], objectives: { NB: [one, { ...one, id: "practiced" }] }, evidence });
 expect(counts.total).toBe(1); expect(counts.untested).toBe(0); expect(counts.inprogress).toBe(1);
 expect(counts.mastered + counts.inprogress + counts.struggling + counts.untested).toBe(counts.total);
});
it("agrees with the lecture calculation and preserves manually completed objectives without practice", () => {
 const objectives = [{ ...one, status: "mastered" }, { id: "two", objective: "Second", linkedLecId: lecture.id, status: "in_progress" }];
 const counts = blockProgressCounts({ blockId: "NB", lectures: [lecture], objectives: { NB: objectives } });
 expect(counts).toMatchObject(lectureProgressCounts(objectives, {}));
 expect(counts.mastered).toBe(1); expect(counts.inprogress).toBe(1);
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
