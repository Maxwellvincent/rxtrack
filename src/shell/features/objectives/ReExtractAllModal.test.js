import { describe, expect, it } from "vitest";
import { mergeLectureContent } from "./ReExtractAllModal.jsx";

describe("objective repair cloud hydration", () => {
  it("restores cloud text and atoms onto a chunk-light local lecture row", () => {
    const local = { id: "l1", lectureTitle: "Local title", chunks: [], atoms: [] };
    const merged = mergeLectureContent(local, {
      chunks: [{ text: "full cloud lecture" }],
      atoms: [{ id: "a1", term: "Cortisol" }],
      meta: { lectureTitle: "Cloud title" },
    });
    expect(merged).toMatchObject({ lectureTitle: "Cloud title" });
    expect(merged.chunks).toHaveLength(1);
    expect(merged.atoms).toHaveLength(1);
  });

  it("keeps local content when the cloud record is absent", () => {
    const local = { id: "l1", chunks: [{ text: "local" }], atoms: [{ id: "a1" }] };
    expect(mergeLectureContent(local, null)).toBe(local);
  });
});
