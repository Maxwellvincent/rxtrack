import { beforeEach, describe, expect, it, vi } from "vitest";
import { installDomStorage } from "../../../stores/testEnv.js";
import { generateExamQuestions } from "./generation.js";

const LECTURE_BODY = "Brachial plexus anatomy. ".repeat(20); // over the 150-char floor

const lectures = [
  { id: "lec1", blockId: "b1", lectureTitle: "Brachial Plexus and Upper Limb", chunks: [{ markdown: LECTURE_BODY }] },
  { id: "lec2", blockId: "b1", lectureTitle: "Cranial Nerves Overview", chunks: [{ markdown: LECTURE_BODY }] },
];

const lecturesById = {
  lec1: lectures[0],
  lec2: lectures[1],
};

const objectivesByLecture = {
  lec1: [{ id: "obj1", objective: "Describe the brachial plexus." }],
  lec2: [{ id: "obj2", objective: "Describe cranial nerve XII." }],
};

function mcq(stem) {
  return {
    stem,
    choices: { A: "Axillary", B: "Radial", C: "Ulnar", D: "Median" },
    correct: "A",
    explanation: "Because.",
  };
}

function tableMcq(stem) {
  return {
    stem,
    choiceLayout: "table",
    choices: { A: { rowA: "x" }, B: { rowB: "y" } },
    correct: "A",
    explanation: "Because.",
  };
}

beforeEach(() => installDomStorage());

describe("generateExamQuestions", () => {
  it("generates once per lecture and stamps provenance on every surviving question", async () => {
    const callAIJSON = vi
      .fn()
      .mockResolvedValueOnce({ questions: [mcq("Q1a"), mcq("Q1b")] }) // lec1
      .mockResolvedValueOnce({ questions: [mcq("Q2a")] }); // lec2

    const result = await generateExamQuestions(
      {
        allocation: { lec1: 2, lec2: 1 },
        lecturesById,
        objectivesByLecture,
        atomsByLecture: {},
        blockId: "b1",
        lectures,
        weakConceptAccuracyByLecture: {},
        userId: null,
      },
      { callAIJSON }
    );

    expect(result.errors).toEqual([]);
    expect(result.questions).toHaveLength(3);
    expect(callAIJSON).toHaveBeenCalledTimes(2); // one call per lecture, not per question

    for (const q of result.questions) {
      expect(q.questionId).toBeTruthy();
      expect(q.blockId).toBe("b1");
    }

    const lec1Questions = result.questions.filter((q) => q.lectureId === "lec1");
    expect(lec1Questions).toHaveLength(2);
    expect(lec1Questions.every((q) => q.objectiveIds).toString()).toBeTruthy();
    for (const q of lec1Questions) expect(q.objectiveIds).toEqual(["obj1"]);

    const lec2Questions = result.questions.filter((q) => q.lectureId === "lec2");
    expect(lec2Questions).toHaveLength(1);
    for (const q of lec2Questions) expect(q.objectiveIds).toEqual(["obj2"]);

    // unique questionIds
    const ids = new Set(result.questions.map((q) => q.questionId));
    expect(ids.size).toBe(3);
  });

  it("filters out table-shaped or non-string choice questions", async () => {
    const callAIJSON = vi.fn().mockResolvedValueOnce({
      questions: [mcq("Good question"), tableMcq("Bad table question")],
    });

    const result = await generateExamQuestions(
      {
        allocation: { lec1: 2 },
        lecturesById,
        objectivesByLecture,
        atomsByLecture: {},
        blockId: "b1",
        lectures,
        weakConceptAccuracyByLecture: {},
        userId: null,
      },
      { callAIJSON }
    );

    expect(result.questions).toHaveLength(1);
    expect(result.questions[0].stem).toBe("Good question");
    // shortfall (1 of 2) triggers retries, which will also return the same
    // mocked table question again and again — so an error should be recorded.
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ lectureId: "lec1", requested: 2 });
  });

  it("retries the shortfall then records an error if still short after 2 retries", async () => {
    // Every attempt (initial + 2 retries = 3 calls) returns only 1 valid question.
    const callAIJSON = vi
      .fn()
      .mockResolvedValueOnce({ questions: [mcq("A1")] })
      .mockResolvedValueOnce({ questions: [mcq("A2")] })
      .mockResolvedValueOnce({ questions: [mcq("A3")] });

    const result = await generateExamQuestions(
      {
        allocation: { lec1: 5 },
        lecturesById,
        objectivesByLecture,
        atomsByLecture: {},
        blockId: "b1",
        lectures,
        weakConceptAccuracyByLecture: {},
        userId: null,
      },
      { callAIJSON }
    );

    expect(callAIJSON).toHaveBeenCalledTimes(3); // 1 initial + 2 retries, then stop
    expect(result.questions).toHaveLength(3); // partial success kept
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ lectureId: "lec1", requested: 5, obtained: 3 });
  });

  it("succeeds fully when a retry makes up the shortfall", async () => {
    const callAIJSON = vi
      .fn()
      .mockResolvedValueOnce({ questions: [mcq("A1")] }) // short: 1 of 2
      .mockResolvedValueOnce({ questions: [mcq("A2")] }); // retry supplies the rest

    const result = await generateExamQuestions(
      {
        allocation: { lec1: 2 },
        lecturesById,
        objectivesByLecture,
        atomsByLecture: {},
        blockId: "b1",
        lectures,
        weakConceptAccuracyByLecture: {},
        userId: null,
      },
      { callAIJSON }
    );

    expect(callAIJSON).toHaveBeenCalledTimes(2);
    expect(result.questions).toHaveLength(2);
    expect(result.errors).toEqual([]);
  });

  it("skips lectures absent from the allocation or allocated zero", async () => {
    const callAIJSON = vi.fn().mockResolvedValue({ questions: [mcq("Q1")] });

    const result = await generateExamQuestions(
      {
        allocation: { lec1: 1, lec2: 0 },
        lecturesById,
        objectivesByLecture,
        atomsByLecture: {},
        blockId: "b1",
        lectures,
        weakConceptAccuracyByLecture: {},
        userId: null,
      },
      { callAIJSON }
    );

    expect(callAIJSON).toHaveBeenCalledTimes(1);
    expect(result.questions).toHaveLength(1);
    expect(result.questions[0].lectureId).toBe("lec1");
  });

  it("threads deps.callAIJSON through startObjectiveQuiz's generators, not bypassed", async () => {
    const callAIJSON = vi.fn().mockResolvedValue({ questions: [mcq("Q1")] });

    await generateExamQuestions(
      {
        allocation: { lec1: 1 },
        lecturesById,
        objectivesByLecture,
        atomsByLecture: {},
        blockId: "b1",
        lectures,
        weakConceptAccuracyByLecture: {},
        userId: null,
      },
      { callAIJSON }
    );

    expect(callAIJSON).toHaveBeenCalled();
    // the prompt (2nd positional arg to callAIJSON) should reflect the lecture content
    const prompt = callAIJSON.mock.calls[0][1];
    expect(prompt).toContain("Brachial plexus anatomy");
  });

  it("reads block-filtered exemplars once and threads them into every lecture's call", async () => {
    localStorage.setItem(
      "rxt-question-banks",
      JSON.stringify({ "b1-exam.pdf": [{ stem: "Exemplar Q", choices: { A: "a" } }] })
    );
    localStorage.setItem(
      "rxt-question-bank-meta",
      JSON.stringify({ m1: { filename: "b1-exam.pdf", blockId: "b1", uploadedAt: 1 } })
    );

    const callAIJSON = vi.fn().mockResolvedValueOnce({ questions: [mcq("Q1")] }).mockResolvedValueOnce({ questions: [mcq("Q2")] });

    await generateExamQuestions(
      {
        allocation: { lec1: 1, lec2: 1 },
        lecturesById,
        objectivesByLecture,
        atomsByLecture: {},
        blockId: "b1",
        lectures,
        weakConceptAccuracyByLecture: {},
        userId: null,
      },
      { callAIJSON }
    );

    expect(callAIJSON).toHaveBeenCalledTimes(2);
    for (const call of callAIJSON.mock.calls) {
      expect(call[1]).toContain("Exemplar Q");
    }
  });
});
