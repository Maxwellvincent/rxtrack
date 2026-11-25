import { describe, expect, it } from "vitest";
import { selectMixedExamQuestions } from "./mixedExam.js";

const q = (id, lectureId) => ({ id, stem: `Stem ${id} about a patient`, choices: { A: "x", B: "y" }, correct: "A", lectureId });
describe("selectMixedExamQuestions", () => {
  it("spreads across lectures, skips clicker banks and duplicates", () => {
    const banks = [
      { filename: "a.pdf", sourceKind: "school", questions: [q(1, "l1"), q(2, "l1"), q(3, "l1"), q(4, "l1")] },
      { filename: "b.pdf", sourceKind: "imcq", questions: [q(5, "l2"), q(1, "l1")] },
      { filename: "c.pdf", sourceKind: "clicker", questions: [q(9, "l3")] },
    ];
    const result = selectMixedExamQuestions(banks, { count: 4, random: () => 0.3 });
    expect(result.available).toBe(5);
    expect(result.questions).toHaveLength(4);
    expect(result.questions.some((item) => item.lectureId === "l2")).toBe(true);
    expect(result.questions.some((item) => item.lectureId === "l3")).toBe(false);
  });
});
