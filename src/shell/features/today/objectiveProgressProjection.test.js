import { expect, it } from "vitest";
import { buildScheduleContext } from "./scheduleContext.js";
import { selectLectureObjectives } from "../../logic/objectives.js";
import { objectivePracticePlan } from "../../../engine/objectivePractice.js";
import { scoreLectures } from "../tracker/lectureRows.js";

it("keeps lecture-list practice equal to the study screen when an old import precedes practiced objective copies", () => {
  const lecture = { id: "l13", blockId: "nb1", lectureNumber: 13, lectureTitle: "NB 13 Cranial Nerves V and VII" };
  const imported = Array.from({ length: 18 }, (_, i) => ({ id: `old${i}`, code: `ANAT.${i}`, objective: `Identify cranial structure ${i}`, linkedLecId: "l13", lectureNumber: 13, status: "struggling" }));
  const extracted = imported.map(o => ({ ...o, id: o.id.replace("old", "new") }));
  const learnerEvidence = { objectives: Object.fromEntries(extracted.slice(0, 7).map(o => [o.id, { attempts: 3, correct: 1, recent: [false] }])) };
  const context = buildScheduleContext({ blockId: "nb1", lectures: [lecture], objectives: { nb1: { imported, extracted } }, learnerEvidence });
  const study = objectivePracticePlan(selectLectureObjectives([...imported, ...extracted], lecture, learnerEvidence), learnerEvidence);
  const library = scoreLectures(context)[0];
  expect(study.worked).toBe(7);
  expect(library).toMatchObject({ practiced: 7, total: 18, struggling: 7, untested: 11 });
  expect(learnerEvidence.objectives.old0).toBeUndefined();
});

it("does not let an earlier copy linked elsewhere hide practice, or count a conflicting lecture mapping", () => {
  const lecture = { id: "l13", blockId: "nb1", lectureNumber: 13 };
  const rows = [
    { id: "other", code: "SAME", objective: "Same school text", linkedLecId: "l14", lectureNumber: 14 },
    { id: "current", code: "SAME", objective: "Same school text", linkedLecId: "l13", lectureNumber: 13 },
    { id: "wrong", code: "WRONG", objective: "Mismatched objective", linkedLecId: "l13", lectureNumber: 17 },
  ];
  const learnerEvidence = { objectives: { current: { attempts: 1, correct: 0 } } };
  const context = buildScheduleContext({ blockId: "nb1", lectures: [lecture], objectives: { nb1: rows }, learnerEvidence });
  expect(scoreLectures(context)[0]).toMatchObject({ practiced: 1, total: 1 });
});
