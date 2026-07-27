import { beforeEach, describe, expect, it, vi } from "vitest";
import { installDomStorage } from "../../../stores/testEnv.js";
import {
  sortWeakestFirst,
  resolveQuestionCount,
  findLectureForQuiz,
  readExemplars,
  buildQuizConfig,
  objectivesAsAtoms,
  startObjectiveQuiz,
} from "./quizLaunch.js";

const LECTURE_BODY = "Brachial plexus anatomy. ".repeat(20); // well over the 150-char floor

const lectures = [
  { id: "lec1", blockId: "b1", lectureTitle: "Brachial Plexus and Upper Limb", chunks: [{ markdown: LECTURE_BODY }] },
  { id: "lec9", blockId: "b2", lectureTitle: "Brachial Plexus and Upper Limb" },
];

describe("quiz launch decisions", () => {
  it("orders the weakest objectives first", () => {
    expect(
      sortWeakestFirst([
        { id: "a", consecutiveCorrect: 3 },
        { id: "b" },
        { id: "c", consecutiveCorrect: 1 },
      ]).map((o) => o.id)
    ).toEqual(["b", "c", "a"]);
  });

  it("resolves the question count the way App did", () => {
    expect(resolveQuestionCount("all", 27)).toBe(27);
    expect(resolveQuestionCount(null, 27)).toBe(10);
    expect(resolveQuestionCount(null, 4)).toBe(4);
    expect(resolveQuestionCount(3, 27)).toBe(3);
    expect(resolveQuestionCount(0, 27)).toBe(1);
  });

  it("matches a lecture by title fragment within the block only", () => {
    expect(findLectureForQuiz(lectures, "b1", "Brachial Plexus and Upper Limb")?.id).toBe("lec1");
    expect(findLectureForQuiz(lectures, "b3", "Brachial Plexus and Upper Limb")).toBeNull();
    expect(findLectureForQuiz(lectures, "b1", "")).toBeNull();
  });

  it("builds a config with the lecture text and the weakest objectives", () => {
    const { config, lectureId } = buildQuizConfig({
      objectives: [
        { id: "a", objective: "Strong one.", consecutiveCorrect: 5 },
        { id: "b", objective: "Weak one." },
      ],
      lectureTitle: "Brachial Plexus and Upper Limb",
      blockId: "b1",
      lectures,
      questionCount: 1,
    });

    expect(config.objectives.map((o) => o.id)).toEqual(["b"]);
    expect(config.lectureText).toContain("Brachial plexus anatomy");
    expect(config.count).toBe(1);
    expect(lectureId).toBe("lec1");
  });

  it("refuses to launch with no objectives", () => {
    expect(buildQuizConfig({ objectives: [], blockId: "b1" }).error).toBeTruthy();
  });
});

describe("exemplars", () => {
  beforeEach(() => installDomStorage());

  it("reads uploaded exam-bank questions and ignores malformed ones", () => {
    localStorage.setItem(
      "rxt-question-banks",
      JSON.stringify({ exam1: [{ stem: "Q?", choices: { A: "a" } }, { stem: "no choices" }] })
    );
    expect(readExemplars()).toHaveLength(1);
    localStorage.setItem("rxt-question-banks", "not json");
    expect(readExemplars()).toEqual([]);
  });
});

describe("startObjectiveQuiz", () => {
  const question = {
    stem: "A 24-year-old presents with weakness. Which nerve?",
    choices: { A: "Axillary", B: "Radial", C: "Ulnar", D: "Median" },
    correct: "A",
    explanation: "Axillary nerve.",
  };

  it("generates from the lecture when there is lecture text", async () => {
    const callAIJSON = vi.fn().mockResolvedValue({ questions: [question] });

    const result = await startObjectiveQuiz(
      {
        objectives: [{ id: "a", objective: "Describe the brachial plexus." }],
        lectureTitle: "Brachial Plexus and Upper Limb",
        blockId: "b1",
        lectures,
      },
      { callAIJSON }
    );

    expect(result.questions).toHaveLength(1);
    expect(result.lectureId).toBe("lec1");
    const prompt = callAIJSON.mock.calls[0][1];
    expect(prompt).toContain("Brachial plexus anatomy");
    expect(prompt).toContain("Describe the brachial plexus.");
  });

  it("falls back to quizzing the objectives themselves when no lecture text exists", async () => {
    const callAIJSON = vi.fn().mockResolvedValue({ questions: [question] });

    const result = await startObjectiveQuiz(
      {
        objectives: [{ id: "a", code: "SOM-1", objective: "Describe the brachial plexus." }],
        lectureTitle: "Imported objectives",
        blockId: "b1",
        lectures: [],
      },
      { callAIJSON }
    );

    expect(result.questions).toHaveLength(1);
    expect(result.error).toBeUndefined();
    expect(callAIJSON.mock.calls[0][1]).toContain("[objective] SOM-1: Describe the brachial plexus.");
  });

  it("maps objectives to atoms and drops text-less ones", () => {
    expect(objectivesAsAtoms([{ id: "a", text: "One." }, { id: "b" }])).toEqual([
      { type: "objective", term: "a", content: "One." },
    ]);
  });

  it("reports the generator's error instead of throwing", async () => {
    const callAIJSON = vi.fn().mockRejectedValue(new Error("model down"));
    const result = await startObjectiveQuiz(
      { objectives: [{ id: "a", objective: "One." }], blockId: "b1", lectures: [] },
      { callAIJSON }
    );
    expect(result.error).toBe("model down");
    expect(result.questions).toEqual([]);
  });
});
