import { describe, expect, it } from "vitest";
import { stripLectureBodyForLocalCache } from "./lectureMetaCache.js";

describe("stripLectureBodyForLocalCache", () => {
  it("keeps list metadata but leaves slide bodies to the on-demand cloud fetch", () => {
    const row = stripLectureBodyForLocalCache({
      id: "lec-1", blockId: "b1", lectureTitle: "Liver Function Tests",
      chunks: [{ markdown: "full slide text" }], fullText: "duplicate full text",
      extractedText: "legacy extracted text", content: "legacy content", images: [{ file: "figure.png" }],
    });
    expect(row).toEqual({ id: "lec-1", blockId: "b1", lectureTitle: "Liver Function Tests", images: [{ file: "figure.png" }] });
  });
});
