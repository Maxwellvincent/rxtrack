import { describe, expect, it } from "vitest";
import { linkSourceLecture, lectureReviewSummary, confirmQuestionBankCurriculumLinks, prepareBankQuestionSet, scoreAnsweredQuestions, sourceLectureClue } from "./questionBankLinks.js";

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

  it("requires an AI-reviewed proposal and explicit learner confirmation before making links active", () => {
    const question = item("q7", "Which pathway is affected?");
    const proposal = { objectiveLinkReviewStatus: "ai-reviewed", objectiveIds: ["obj-1", "unknown"], lectureIds: ["lec-1", "unknown"] };
    expect(confirmQuestionBankCurriculumLinks(question, proposal, { objectiveIds: ["obj-1"], lectureIds: ["lec-1"] }))
      .toMatchObject({ objectiveIds: ["obj-1"], lectureId: "lec-1", curriculumLinkStatus: "user-confirmed" });
    expect(confirmQuestionBankCurriculumLinks(question, { ...proposal, objectiveLinkReviewStatus: "candidate" }, { objectiveIds: ["obj-1"] }))
      .toBeNull();
  });
});

it("attributes explicit NB05 homework labels only to a unique current-block number and title", () => {
  const question = { ...item("q5", "Which organelle?"), sourceSection: "NB 05", sourceSectionTitle: "Neurons and Glia" };
  const lectures = [{ id: "nb05", blockId: "nb1", lectureNumber: 5, lectureTitle: "NB 05 Neurons and Glia" }, { id: "other05", blockId: "nb2", lectureNumber: 5, lectureTitle: "NB 05 Neurons and Glia" }];
  expect(linkSourceLecture(question, lectures, "nb1")).toMatchObject({ lectureId: "nb05", curriculumLinkStatus: "source-label-matched" });
  expect(linkSourceLecture(question, lectures, "nb1").objectiveIds).toBeUndefined();
  expect(linkSourceLecture(question, [...lectures, { ...lectures[0], id: "duplicate" }], "nb1").lectureId).toBeUndefined();
  expect(linkSourceLecture(question, [{ ...lectures[0], lectureTitle: "Auditory pathways" }], "nb1").lectureId).toBeUndefined();
});
it("ranks missed lectures using answered questions only", () => {
  const summary = lectureReviewSummary({ questions: [{ questionId: "a", lectureId: "l5", correct: "A" }, { questionId: "b", lectureId: "l6", correct: "A" }, { questionId: "c", lectureId: "l5", correct: "A" }], answers: [{ questionId: "a", value: "B" }, { questionId: "b", value: "A" }] }, { l5: "Neurons and Glia" });
  expect(summary[0]).toMatchObject({ lectureId: "l5", label: "Neurons and Glia", answered: 1, misses: 1 });
  expect(summary[1]).toMatchObject({ lectureId: "l6", answered: 1, correct: 1 });
});
