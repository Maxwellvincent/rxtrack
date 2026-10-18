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
