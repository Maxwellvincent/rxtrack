import { describe, expect, it } from "vitest";
import { buildQuestionBankAnalysis, classifyQuestionFocus, mergeQuestionBankCritique } from "./questionBankAnalysis.js";

const question = {
  id: "q1",
  num: 1,
  type: "clinicalVignette",
  stem: "A 7-year-old with a family history of disease has a serum value that is increased. Which inheritance pattern is most likely?",
  choices: { A: "Autosomal dominant", B: "Autosomal recessive" },
  correct: "A",
  explanation: "The pedigree and presentation support the pattern.",
  sourceKeyStatus: "present",
};

describe("question bank analysis", () => {
  it("extracts clinical, inheritance, and laboratory signals", () => {
    const result = classifyQuestionFocus(question);
    expect(result.focus).toBe("genetics / inheritance");
    expect(result.clinical).toBe(true);
    expect(result.cues).toEqual(expect.arrayContaining(["clinical presentation", "family / inheritance clue", "laboratory clue"]));
  });

  it("links imported questions to supplied objectives and preserves key uncertainty", () => {
    const analysis = buildQuestionBankAnalysis({
      questions: [question],
      objectives: [{ id: "obj-1", objective: "Explain inheritance patterns and family history clues" }],
      lectures: [{ id: "lec-1", lectureTitle: "Genetics", teachingMap: { clinicalHook: "A child with family history" } }],
      filename: "Homework genetics.pdf",
      sourceKind: "supplemental",
      expectedQuestions: 1,
    });
    expect(analysis.complete).toBe(true);
    expect(analysis.sourceLabel).toBe("Homework / supplemental");
    expect(analysis.items[0].sourceKeyStatus).toBe("present");
    expect(analysis.items[0].objectiveIds).toContain("obj-1");
    expect(analysis.items[0].correctnessStatus).toBe("source-key-present-not-medically-audited");
  });

  it("merges critique without replacing the uploaded answer key", () => {
    const analysis = buildQuestionBankAnalysis({ questions: [question] });
    const merged = mergeQuestionBankCritique(analysis, { items: [{ id: "q1", correctnessStatus: "needs-review", critique: "Review the source rationale." }] });
    expect(merged.status).toBe("reviewed");
    expect(merged.items[0].correctnessStatus).toBe("needs-review");
    expect(question.correct).toBe("A");
  });
});
