import { describe, it, expect } from "vitest";
import {
  objectiveTextKeywords,
  findRelevantLectureExcerpt,
  excerptPlainText,
  findRelevantMcqLectureChunk,
  mcqLectureSnippetPreview,
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

describe("findRelevantMcqLectureChunk", () => {
  it("skips metadata chunks and picks body with two keyword hits", () => {
    const cover =
      "St. George University\nBasic Principles of Medicine\nModule: XYZ\n" + "filler ".repeat(40);
    const body =
      "The brachial plexus is formed by ventral rami. The median nerve runs with important vascular structures in the arm. More clinical content continues here.";
    const lec = { chunks: [{ text: cover }, { markdown: body }] };
    const ch = findRelevantMcqLectureChunk(lec, { text: "Explain brachial plexus and median nerve anatomy" });
    expect(ch).toBeTruthy();
    expect(String(ch.markdown || ch.text).toLowerCase()).toContain("brachial");
  });

  it("returns null when fewer than two keywords match", () => {
    const body = "xxxxxxxx brachial xxxxxxxx ".repeat(12);
    const lec = { chunks: [{ markdown: body }] };
    expect(
      findRelevantMcqLectureChunk(lec, { text: "Explain zebratestword and brachial relations" })
    ).toBeNull();
  });
});

describe("mcqLectureSnippetPreview", () => {
  it("returns null when filtered text is too short", () => {
    expect(mcqLectureSnippetPreview({ text: "short" })).toBeNull();
  });

  it("returns snippet when enough long lines remain", () => {
    const chunk = {
      text:
        "Line one with enough characters in it here for the filter.\nLine two also with enough content here for display.\n",
    };
    const p = mcqLectureSnippetPreview(chunk);
    expect(p && p.length > 50).toBe(true);
  });
});
