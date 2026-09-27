import { describe, expect, it } from "vitest";
import { cleanLectureTitle, formatLectureLabel } from "./lectureTitle.js";

describe("lecture labels", () => {
  it("preserves the catalog lecture number and avoids duplicating it from the title", () => {
    expect(formatLectureLabel({ lectureType: "LEC", lectureNumber: 25, lectureTitle: "Lec 25 - Exocrine Pancreas.pdf" }))
      .toBe("LEC 25 · Exocrine Pancreas");
  });

  it("recovers a lecture number from the title when catalog metadata is absent", () => {
    expect(formatLectureLabel({ lectureTitle: "DLA 1 - Structure and Function.pdf" }))
      .toBe("DLA 1 · Structure and Function");
    expect(cleanLectureTitle("Liver Function Tests.pdf")).toBe("Liver Function Tests");
  });
});
