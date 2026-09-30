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

  it("marks only curriculum IDs present in the supplied curriculum as reviewer proposals", () => {
    const analysis = buildQuestionBankAnalysis({ questions: [question] });
    const merged = mergeQuestionBankCritique(analysis, { items: [{ id: "q1", objectiveIds: ["obj-1", "hallucinated"], lectureIds: ["lec-1", "other"] }] }, {
      objectiveIds: ["obj-1"], lectureIds: ["lec-1"],
    });
    expect(merged.items[0]).toMatchObject({ objectiveIds: ["obj-1"], lectureIds: ["lec-1"], objectiveLinkReviewStatus: "ai-reviewed" });
  });

  it("matches explicit source lecture titles and searches saved lecture text for candidate support", () => {
    const analysis = buildQuestionBankAnalysis({
      questions: [{ ...question, stem: `${question.stem} Lecture 2: Clinical Embryology of GI System` }],
      lectures: [{ id: "lec-2", lectureTitle: "Clinical Embryology of GI System", chunks: [{ markdown: "Meckel diverticulum and intestinal rotation" }] }],
    });
    expect(analysis.items[0].lectureIds).toContain("lec-2");
    expect(analysis.items[0].lectureLinks[0].label).toContain("Clinical Embryology");
  });

  it("retains per-question prior performance and aggregates it separately from the answer key", () => {
    const analysis = buildQuestionBankAnalysis({
      questions: [
        { ...question, sourceAttemptCorrect: false, sourceScore: "0/1", schoolLearningOutcomes: "Gastrointestinal system" },
        { ...question, id: "q2", num: 2, sourceAttemptCorrect: true, sourceScore: "1/1" },
      ],
      filename: "ESoftQuiz2-DM-Report.pdf",
      expectedQuestions: 2,
    });
    expect(analysis.sourcePerformance).toEqual({ count: 2, correct: 1, incorrect: 1, accuracy: 50 });
    expect(analysis.items[0]).toMatchObject({ sourceAttemptCorrect: false, sourceScore: "0/1", schoolLearningOutcomes: "Gastrointestinal system" });
  });
});
