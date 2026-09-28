import { describe, expect, it } from "vitest";
import { prepareBankQuestionSet, scoreAnsweredQuestions, sourceLectureClue } from "./questionBankLinks.js";

const item = (id, stem, choices = { A: "Atresia", B: "Stenosis" }) => ({ id, stem, choices, correct: "A" });

describe("question-bank source linking", () => {
  it("reads an explicit lecture label without claiming that it is a verified block link", () => {
    expect(sourceLectureClue(item("q1", "Newborn has bilious vomiting. Lecture 2: Clinical Embryology of GI System")))
      .toMatchObject({ number: 2, title: "Clinical Embryology of GI System" });
    const result = prepareBankQuestionSet([item("q1", "Newborn has bilious vomiting. Lecture 2: Clinical Embryology of GI System")]);
    expect(result.questions[0]).toMatchObject({ sourceLectureNumber: 2, candidateLinkBasis: null });
    expect(result.questions[0]).not.toHaveProperty("lectureId");
  });

  it("attaches candidate lecture/objective review hints from analysis and removes repeated items only for the run", () => {
    const first = item("q1", "Newborn has bilious vomiting; a double bubble sign is seen. Lecture 2: Clinical Embryology of GI System");
    const repeat = item("q2", "Newborn has bilious vomiting; a double bubble sign is seen. Lecture 2: Clinical Embryology of GI System");
    const result = prepareBankQuestionSet([first, repeat], { items: [{ id: "q1", num: 1, lectureLinks: [{ id: "l2", label: "Clinical Embryology of GI System" }], objectiveLinks: [{ id: "o2", label: "Explain intestinal rotation" }], objectiveBasis: "candidate-overlap" }] });
    expect(result.questions).toHaveLength(1);
    expect(result.removedDuplicateCount).toBe(1);
    expect(result.questions[0].candidateLectureLinks[0].id).toBe("l2");
    expect(result.questions[0].candidateObjectiveLinks[0].id).toBe("o2");
    expect(result.questions[0].objectiveIds).toBeUndefined();
  });

  it("grades only answers attached to questions and reports honest partial progress", () => {
    expect(scoreAnsweredQuestions({ questions: [{ questionId: "q1", correct: "A" }, { questionId: "q2", correct: "B" }], answers: [{ questionId: "q1", value: "A" }, { questionId: "q2", value: "A" }, { questionId: "gone", value: "A" }] }))
      .toEqual({ answered: 2, correct: 1, incorrect: 1, accuracy: 50 });
  });
});
