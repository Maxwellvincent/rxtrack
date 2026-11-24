import { expect, it, vi } from "vitest";
import { loadExamLectureEvidence } from "./lectureEvidence.js";

it("hydrates chunk-light metadata with cloud text and facts without modifying the list record", async () => {
  const lecture = { id: "nb13", blockId: "nb1", lectureTitle: "Cranial Nerves" };
  const fetchContent = vi.fn(async () => ({ chunks: [{ markdown: "Source-grounded lecture relationships. ".repeat(20) }], atoms: [{ term: "V2", content: "A source fact" }] }));
  const result = await loadExamLectureEvidence(lecture, [], { userId: "user", fetchContent });
  expect(fetchContent).toHaveBeenCalledWith("user", "nb13");
  expect(result.lectureText).toContain("Source-grounded lecture relationships");
  expect(result.atoms).toHaveLength(1);
  expect(lecture.chunks).toBeUndefined();
});
it("uses adequate inline content without a redundant fetch", async () => {
  const fetchContent = vi.fn();
  await loadExamLectureEvidence({ id: "l", fullText: "Already loaded lecture content. ".repeat(20) }, [], { userId: "u", fetchContent });
  expect(fetchContent).not.toHaveBeenCalled();
});
it("supports facts-only cloud extraction and distinguishes missing content from transport failure", async () => {
  const lecture = { id: "l" };
  const loaded = await loadExamLectureEvidence(lecture, [], { userId: "u", fetchContent: async () => ({ atoms: [{ content: "Saved fact" }] }) });
  expect(loaded.atoms).toHaveLength(1);
  await expect(loadExamLectureEvidence(lecture, [], { userId: "u", fetchContent: async () => null })).rejects.toThrow("No usable lecture text");
  await expect(loadExamLectureEvidence(lecture, [], { userId: "u", fetchContent: async () => { throw new Error("offline"); } })).rejects.toThrow("re-uploading is not required");
});

it("keeps slide/page boundaries so whole-lecture evidence can be used", async () => {
  const lecture = { id: "nb59", blockId: "nb3", chunks: [{ markdown: "Slide one: major depressive episode criteria. ".repeat(5) }, { markdown: "Slide two: bipolar I versus bipolar II durations. ".repeat(5) }] };
  const result = await loadExamLectureEvidence(lecture, [{ term: "MDD", content: "2 weeks" }], {});
  expect(result.lectureText).toContain("\f");
  expect(result.lectureText).toContain("Slide two");
});

it("loads the lecture text even when extracted facts are already available", async () => {
  const lecture = { id: "nb56", blockId: "nb3", lectureTitle: "Anxiety" };
  const fetchContent = vi.fn(async () => ({ chunks: [{ markdown: "Panic disorder requires one month of worry. ".repeat(6) }, { markdown: "GAD lasts six months. ".repeat(8) }] }));
  const result = await loadExamLectureEvidence(lecture, [{ term: "GAD", content: "6 months" }], { userId: "user", fetchContent });
  expect(fetchContent).toHaveBeenCalledWith("user", "nb56");
  expect(result.lectureText).toContain("Panic disorder");
  expect(result.atoms).toEqual([{ term: "GAD", content: "6 months" }]);
});
