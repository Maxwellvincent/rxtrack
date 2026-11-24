import { describe, expect, it } from "vitest";
import { quizAnswerKey, questionHistory, answeredQuestionKeys } from "./questionHistory.js";
import { questionEvidenceKey } from "../stores/learnerEvidence.js";

describe("question history", () => {
  const school = (id, stem) => ({ id, stem, sourceFile: "Week 15 NB BEHS Practice Questions With Answers", sourceRepresentation: "original-school-question" });
  it("keys original school questions by their text, so q5 in two banks are different questions", () => {
    const a = quizAnswerKey(school("q5", "A 21-year-old woman worries about everything for 5 1/2 months."));
    const b = quizAnswerKey({ ...school("q5", "A 30-year-old man has panic attacks."), sourceFile: "Week 16 NB BEHS Practice Questions" });
    expect(a).not.toBe(b);
    expect(quizAnswerKey(school("q9", "A 21-year-old  woman worries about everything for 5 1/2 months."))).toBe(a);
    expect(quizAnswerKey({ poolId: "pool-1", id: "q1", stem: "generated" })).toBe("pool-1");
  });
  it("summarizes how often and how well a question was answered", () => {
    const key = questionEvidenceKey(quizAnswerKey(school("q5", "Stem text")));
    const journal = [
      { questionKey: key, correct: true, at: 3 }, { questionKey: "other", correct: false, at: 2 },
      { questionKey: key, correct: false, at: 1 },
    ];
    expect(questionHistory(journal, key)).toEqual({ count: 2, correct: 1, results: [false, true], lastAt: 3 });
    expect(questionHistory(journal, "missing")).toBeNull();
    expect(answeredQuestionKeys(journal).has(key)).toBe(true);
  });
});
