import { describe, it, expect } from "vitest";
import { SECTION_CHAR_CAP, sliceAtBoundary, splitLectureIntoSections } from "./lectureText.js";

describe("sliceAtBoundary", () => {
  it("returns short text untouched", () => {
    expect(sliceAtBoundary("short body", 100)).toBe("short body");
  });

  it("never exceeds the cap", () => {
    const long = "word ".repeat(5000);
    expect(sliceAtBoundary(long, 100).length).toBeLessThanOrEqual(100);
  });

  it("cuts at a sentence end rather than mid-word", () => {
    const text = "Insulin lowers glucose. Glucagon raises it. Somatostatin damps both signals.";
    const out = sliceAtBoundary(text, 50);
    expect(out.endsWith(".")).toBe(true);
    expect(out).toBe("Insulin lowers glucose. Glucagon raises it.");
  });

  it("prefers a paragraph break when one is near the end of the window", () => {
    const text = "Alpha cells make glucagon.\n\nBeta cells make insulin and amylin together.";
    expect(sliceAtBoundary(text, 40)).toBe("Alpha cells make glucagon.");
  });

  it("keeps most of the window when the only break is early", () => {
    const text = "Hi.\n\n" + "x".repeat(500);
    // A break at index 3 must not shrink a 200-char window down to 3 chars.
    expect(sliceAtBoundary(text, 200).length).toBeGreaterThan(150);
  });

  it("defaults to a cap far above the old 2000-character limit", () => {
    expect(SECTION_CHAR_CAP).toBeGreaterThan(2000);
  });
});

describe("splitLectureIntoSections", () => {
  const lecture = Array.from({ length: 60 }, (_, i) => `Sentence number ${i} about the pancreas.`).join(" ");

  it("returns one window per section", () => {
    expect(splitLectureIntoSections(lecture, 3)).toHaveLength(3);
  });

  it("covers the whole lecture rather than only the opening", () => {
    const [, , last] = splitLectureIntoSections(lecture, 3);
    expect(last).toContain("59");
  });

  it("survives empty input and a zero count", () => {
    expect(splitLectureIntoSections("", 3)).toEqual(["", "", ""]);
    expect(splitLectureIntoSections(lecture, 0)).toHaveLength(1);
  });
});
