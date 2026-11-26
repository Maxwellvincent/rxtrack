import { describe, expect, it, vi } from "vitest";
import { launchLectureSchoolQuestions, schoolQuestionSummary, schoolQuestionsByLecture } from "./lectureSchoolQuestions.js";

const banks = {
  "NB3 Homework wk 10.pdf": [
    { id: "h1", stem: "a", correct: "A", lectureId: "L1" },
    { id: "h2", stem: "b", correct: "B", lectureId: "L2" },
    { id: "h3", stem: "no key", lectureId: "L1" },
  ],
  "IMCQ 07 KEY.pdf": [
    { id: "i1", stem: "c", correct: "C", lectureId: "L1", curriculumLinkStatus: "evidence-verified", secondaryLectureIds: ["L2"] },
    { id: "i2", stem: "d", correct: "D", lectureId: "L1", secondaryLectureIds: ["L3"] },
  ],
  "NB2 E-SOFT 5.pdf": [{ id: "e1", stem: "e", correct: "E", lectureId: "L1" }],
};
const meta = { a: { filename: "NB3 Homework wk 10.pdf", sourceKind: "homework" } };

describe("schoolQuestionsByLecture", () => {
  const map = schoolQuestionsByLecture(banks, meta);
  it("counts keyed questions per format and lecture", () => {
    expect(map.L1.counts).toEqual({ homework: 1, imcq: 2, esoft: 1, other: 0 });
    expect(map.L1.total).toBe(4);
    expect(map.L1.verified).toBe(1);
  });
  it("counts verified second lectures only", () => {
    expect(map.L2.counts).toMatchObject({ homework: 1, imcq: 1 });
    expect(map.L3).toBeUndefined();
  });
  it("summarises formats with questions", () => {
    expect(schoolQuestionSummary(map.L1)).toBe("1 homework · 2 IMCQ · 1 ESoft");
    expect(schoolQuestionSummary(null)).toBe("");
  });
});

describe("launchLectureSchoolQuestions", () => {
  it("applies figures per source bank and launches untimed practice", async () => {
    const entry = schoolQuestionsByLecture(banks, meta).L1;
    const loadFigures = vi.fn(async () => ({}));
    const launch = vi.fn(async () => ({ id: "s1" }));
    const result = await launchLectureSchoolQuestions({ userId: "u", blockId: "b", lecture: { lectureTitle: "Renal" }, entry }, { loadFigures, launch });
    expect(result).toEqual({ id: "s1" });
    expect(loadFigures).toHaveBeenCalledTimes(3);
    const [args] = launch.mock.calls[0];
    expect(args.format).toBe("practice");
    expect(args.filename).toBe("Renal · school questions");
    expect(args.questions).toHaveLength(4);
    expect(args.questions.find(q => q.id === "e1").sourceFile).toBe("NB2 E-SOFT 5.pdf");
  });
});
