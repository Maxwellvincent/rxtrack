import { expect, it } from "vitest";
import { scoreLectures, buildLectureRows } from "./lectureRows.js";
it("counts linked answers as practice without treating developing labels as evidence", () => {
  const context = { blockId: "block", lectures: [{ id: "lecture", blockId: "block", lectureTitle: "Lecture" }],
    objectives: [ { id: "answered", linkedLecId: "lecture", status: "inprogress" }, { id: "labelOnly", linkedLecId: "lecture", status: "inprogress" } ],
    learnerEvidence: { objectives: { answered: { attempts: 1, correct: 0, recent: [false] } } } };
  const scores = scoreLectures(context);
  expect(scores[0].practiced).toBe(1);
  const rows = buildLectureRows(scores, { blockId: "block", filter: "all" });
  expect(rows[0]).toMatchObject({ practiced: 1, total: 2, mastered: 0 });
});
