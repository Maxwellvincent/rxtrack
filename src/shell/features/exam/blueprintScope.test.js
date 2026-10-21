import { describe, it, expect } from "vitest";
import { blockBlueprintContext, blockBlueprintBanks } from "./blueprintScope.js";
import { blueprintReadiness } from "./BpmBlueprintDashboard.jsx";
import { allocateBlueprint } from "./bpmBlueprint.js";
const lectures = ["NB", "DM", "ER"].map(blockId => ({ id: blockId.toLowerCase(), blockId, lectureTitle: blockId, atoms: [{ id: `${blockId}-fact` }] }));
const objectives = Object.fromEntries(lectures.map(lecture => [lecture.blockId, [{ id: `${lecture.id}-obj`, code: `SOM.MKII.BPM2.1.${lecture.blockId}.1.ANAT.1`, linkedLecId: lecture.id, discipline: "ANAT", objective: `${lecture.blockId} anatomy` }]]));
describe("block exam blueprint scope", () => {
 it("uses NB1 curriculum for readiness and allocation without ER or DM", () => {
  const context = blockBlueprintContext("NB", lectures, objectives);
  expect(context.lectures.map(lecture => lecture.id)).toEqual(["nb"]);
  expect(Object.keys(context.atomsByLecture)).toEqual(["nb"]);
  const rows = blueprintReadiness(3, context.objectivesByLecture);
  expect(rows.flatMap(row => row.items).map(item => item.id)).toEqual(["nb-obj"]);
  const complete = blockBlueprintContext("NB", lectures, { ...objectives, NB: [...objectives.NB, { id: "nb-n", linkedLecId: "nb", discipline: "NSCI", objective:"Describe neural pathways" }, { id: "nb-h", linkedLecId: "nb", discipline: "HCB", objective:"Describe tissue layers" }] });
  const allocation = allocateBlueprint({ exam: 3, eligibleLectures: complete.eligibleLectures, objectivesByLecture: complete.objectivesByLecture, requestedCount: 40 });
  expect(allocation).toEqual({ "nb::bpm::anatomy": 20, "nb::bpm::neuroscience": 17, "nb::bpm::histology": 3 });
 });
 it("does not trust a foreign lecture link even inside the NB objective bucket", () => {
  const context = blockBlueprintContext("NB", lectures, { NB: [...objectives.NB, objectives.DM[0]] });
  expect(Object.keys(context.objectivesByLecture)).toEqual(["nb"]);
 });
 it("filters school sources and mixed banks per question, not by subject", () => {
  const banks = [{ blockId: "DM", questions: [{ id: "dm", subject: "Anatomy" }] }, { blockId: "NB", questions: [{ id: "nb" }, { id: "foreign", blockId: "ER" }, { id: "foreign-link", lectureId: "dm" }] }, { questions: [{ id: "linked", lectureId: "nb" }, { id: "unknown", subject: "Anatomy" }] }];
  expect(blockBlueprintBanks(banks, "NB", lectures).flatMap(bank => bank.questions).map(question => question.id)).toEqual(["nb", "linked"]);
  expect(banks[1].questions).toHaveLength(3);
 });
});
it("excludes conflicting block metadata and deduplicates exact objective codes", () => {
 const context = blockBlueprintContext("NB", lectures, {NB: [objectives.NB[0], {...objectives.NB[0], id:"duplicate"}, {id:"foreign", linkedLecId:"nb", blockId:"ER", objective:"Foreign record"}]});
 expect(context.objectivesByLecture.nb.map(o=>o.id)).toEqual(["nb-obj"]);
});

it("preserves the practiced duplicate identity for blueprint readiness", () => {
 const original=objectives.NB[0];
 const evidence={objectives:{practiced:{attempts:2,correct:1}}};
 const context=blockBlueprintContext("NB",lectures,{NB:[original,{...original,id:"practiced"}]},evidence);
 expect(context.objectivesByLecture.nb[0].id).toBe("practiced");
 expect(blueprintReadiness(3,context.objectivesByLecture,evidence)[0]).toMatchObject({practiced:1,untested:0});
});
