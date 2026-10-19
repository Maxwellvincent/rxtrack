import { describe, it, expect } from "vitest";
import { multipartGroups, multipartIdentity, relinkMultipartObjectives, multipartHistory } from "./multipartLectures.js";
import { parseLectureFilename, findFillTarget, combineLectureParts } from "./lectureIngest.js";
const one = { chunks: [{ markdown: "body" }], id: "one", blockId: "NB1", termId: "T2", lectureType: "DLA", lectureNumber: 3, filename: "NB+DLA+03+Neurotransmitter+Pathways+and+roles%281%29+-+Before+NB+09.pdf", lectureTitle: "Before NB 09" };
const two = { ...one, id: "two", filename: "NB+DLA+03+Neurotransmitters+Pathways+and+roles%282%29+-+Before+NB+09.pdf" };
describe("multipart lecture matching", () => {
 it("recognizes both original NB DLA 3 source filenames in part order", () => {
  expect(multipartGroups([two, one])).toEqual([[one, two]]);
  expect(multipartIdentity(one).key).toBe(multipartIdentity(two).key);
  expect(parseLectureFilename(one.filename).title).toContain("Neurotransmitter Pathways");
  expect(findFillTarget([one], { ...two, lectureTitle: "second source", chunks: [{ markdown: "body" }] })).toBeNull();
 });
 it("does not combine shared numbers, ambiguous duplicates, lettered DLAs or other blocks", () => {
  expect(multipartGroups([{ ...one, filename: "DLA 3 - Before NB09.pdf" }, { ...two, filename: "DLA 3 - Before NB09.pdf" }])).toEqual([]);
  expect(multipartGroups([one, { ...two, filename: one.filename }])).toEqual([]);
  expect(multipartGroups([one, { ...two, blockId: "other" }])).toEqual([]);
  expect(multipartGroups([{ ...one, lectureSuffix: "a" }, { ...two, lectureSuffix: "b" }])).toEqual([]);
 });
 it("keeps objective IDs, performance and provenance while unifying lecture links", () => {
  const objectives = { imported: [{ id: "a", linkedLecId: "two", accuracy: 0.8, attempts: [1, 2] }], extracted: [{ id: "b", linkedLecId: "one" }] };
  const next = relinkMultipartObjectives(objectives, ["one", "two"], "one");
  expect(next.imported[0]).toEqual({ ...objectives.imported[0], linkedLecId: "one", originalLectureId: "two" });
  expect(objectives.imported[0].linkedLecId).toBe("two");
 });
 it("supports numeric and Roman explicit part suffixes", () => {
  expect(multipartIdentity({ ...one, filename: "DLA 3 - Pathways Part II.pdf" }).part).toBe(2);
  const lecture = combineLectureParts([1, 2].map(n => ({ filename: `DLA 3 - Pathways Part ${n}.pdf`, lecture: { ...one, lectureTitle: `Pathways Part ${n}`, chunks: [{ markdown: `section ${n}` }] } }))).lecture;
  expect(lecture.lectureTitle).toBe("Pathways");
 });
 it("retains activity from both parts without mutating stored history", () => {
  const history = { "one__NB1": { lastActivityDate: "2026-10-18", activityLog: [{ id: "a" }] }, "two__NB1": { lastActivityDate: "2026-10-19", activityLog: [{ id: "b" }] } };
  const merged = multipartHistory([{ ...one, mergedFrom: [{ id: "one" }, { id: "two" }] }], history, "NB1");
  expect(merged["one__NB1"].lastActivityDate).toBe("2026-10-19");
  expect(merged["one__NB1"].activityLog).toHaveLength(2);
  expect(history["one__NB1"].activityLog).toHaveLength(1);
 });
 it("does not schedule already merged documents again", () => {
  expect(multipartGroups([{ ...one, combinedParts: 2 }, { ...two, mergedInto: "one" }])).toEqual([]);
 });
});
