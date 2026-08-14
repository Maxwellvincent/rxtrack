import { describe, it, expect } from "vitest";
import {
  objectiveTextKeywords,
  findRelevantLectureExcerpt,
  excerptPlainText,
} from "./drillLectureSnippet";

describe("objectiveTextKeywords", () => {
  it("returns words longer than 4 chars from objective text", () => {
    expect(objectiveTextKeywords({ text: "Describe the brachial plexus and its branches" })).toEqual(
      expect.arrayContaining(["describe", "brachial", "plexus", "branches"])
    );
    expect(objectiveTextKeywords({ text: "Describe the brachial plexus and its branches" })).not.toContain("the");
  });

  it("falls back to objective field", () => {
    expect(objectiveTextKeywords({ objective: "Explain proximal humerus anatomy" })).toContain("explain");
    expect(objectiveTextKeywords({ objective: "Explain proximal humerus anatomy" })).toContain("proximal");
  });
});

describe("findRelevantLectureExcerpt", () => {
  it("matches first chunk by keyword", () => {
    const lec = {
      chunks: [
        { text: "Unrelated intro about cells." },
        { markdown: "The **brachial plexus** forms from ventral rami." },
      ],
    };
    const ex = findRelevantLectureExcerpt(lec, { text: "Describe brachial plexus" }, () => "");
    expect(ex?.source).toBe("chunk");
    expect(excerptPlainText(ex).toLowerCase()).toContain("brachial");
  });

  it("falls back to full text when chunks miss", () => {
    const lec = { chunks: [{ text: "Only mitochondria here." }] };
    const full =
      "Introduction. The suprascapular nerve passes through the suprascapular notch. More filler text at the end.";
    const ex = findRelevantLectureExcerpt(lec, { text: "Explain suprascapular nerve course" }, () => full);
    expect(ex?.source).toBe("fullText");
    expect(excerptPlainText(ex).toLowerCase()).toContain("suprascapular");
  });

  it("returns null without keywords", () => {
    expect(findRelevantLectureExcerpt({}, { text: "a b c" }, () => "longword here")).toBeNull();
  });
});

describe("excerptPlainText", () => {
  it("joins chunk markdown or text", () => {
    expect(excerptPlainText({ source: "chunk", markdown: "  x  " })).toBe("x");
    expect(excerptPlainText({ source: "chunk", text: "y" })).toBe("y");
  });
});
