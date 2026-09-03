import { beforeEach, describe, expect, it, vi } from "vitest";
import { installDomStorage } from "../../../stores/testEnv.js";
import {
  sortWeakestFirst,
  resolveQuestionCount,
  findLectureForQuiz,
  readExemplars,
  readExemplarsForBlock,
  buildQuizConfig,
  objectivesAsAtoms,
  startObjectiveQuiz,
  resolveDefaultDifficulty,
  selectAtomsByObjectiveCoverage,
  selectExemplarsForBlock,
} from "./quizLaunch.js";
import * as atomProgressStore from "../../../stores/atomProgress.js";

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

describe("block-filtered exemplars", () => {
  beforeEach(() => installDomStorage());

  it("returns only exemplars from banks whose meta blockId matches", () => {
    localStorage.setItem(
      "rxt-question-banks",
      JSON.stringify({
        "b1-exam.pdf": [{ stem: "B1 Q?", choices: { A: "a" } }],
        "b2-exam.pdf": [{ stem: "B2 Q?", choices: { A: "a" } }],
      })
    );
    localStorage.setItem(
      "rxt-question-bank-meta",
      JSON.stringify({
        m1: { filename: "b1-exam.pdf", blockId: "b1", uploadedAt: 1 },
        m2: { filename: "b2-exam.pdf", blockId: "b2", uploadedAt: 2 },
      })
    );

    const result = readExemplarsForBlock(null, "b1");
    expect(result).toHaveLength(1);
    expect(result[0].stem).toBe("B1 Q?");
  });

  it("does not borrow unrelated blocks when no bank matches the block", () => {
    localStorage.setItem(
      "rxt-question-banks",
      JSON.stringify({
        "b2-exam.pdf": [{ stem: "B2 Q?", choices: { A: "a" } }],
      })
    );
    localStorage.setItem(
      "rxt-question-bank-meta",
      JSON.stringify({
        m2: { filename: "b2-exam.pdf", blockId: "b2", uploadedAt: 2 },
      })
    );

    const result = readExemplarsForBlock(null, "b1");
    expect(result).toEqual([]);
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
      { type: "objective", term: "a", content: "One.", objectiveIds: ["a"] },
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

describe("startObjectiveQuiz — atom-driven (Quiz/Study unification)", () => {
  beforeEach(() => installDomStorage());

  const atoms = [
    { type: "definition", term: "Thyroglobulin", content: "Scaffold protein for T3/T4 synthesis." },
    { type: "relationship", term: "Pendrin", content: "Apical iodide/chloride exchanger." },
  ];

  it("prefers real atoms over the free-form generator when atoms are available", async () => {
    const callAIJSON = vi.fn().mockResolvedValue({
      questions: [
        { stem: "A slide shows a thyroid follicle...?", choices: { A: "Thyroglobulin", B: "x", C: "y", D: "z" }, correct: "A" },
      ],
    });
    const result = await startObjectiveQuiz(
      { objectives: [], lectureTitle: "Thyroid", blockId: "b1", lectures: [], atoms, questionCount: 1, userId: "u1", lectureIdHint: "lec1" },
      { callAIJSON }
    );
    // One-per-atom prompt, not the free-form buildMcqPrompt shape
    expect(callAIJSON.mock.calls[0][1]).toMatch(/one question per fact/i);
    expect(result.questions[0].atomKey).toBe("thyroglobulin");
  });

  it("draws not-yet-complete atoms first, per that lecture's own atomProgress", async () => {
    // objectives carry linkedLecId so buildQuizConfig/findLectureForQuiz resolves a lectureId —
    // simplest path here is a lecture match by title, same as the "generates from the lecture" test.
    atomProgressStore.recordAtomAnswer("u1", "lec1", "thyroglobulin", true); // already complete
    const callAIJSON = vi.fn().mockResolvedValue({ questions: [] });
    await startObjectiveQuiz(
      {
        objectives: [],
        lectureTitle: "Brachial Plexus and Upper Limb",
        blockId: "b1",
        lectures,
        atoms,
        questionCount: 1,
        userId: "u1",
      },
      { callAIJSON }
    );
    // Only 1 question requested, and pendrin (needs-review/untouched) outranks the completed atom.
    const prompt = callAIJSON.mock.calls[0][1];
    expect(prompt).toContain("Pendrin");
    expect(prompt).not.toContain("Thyroglobulin");
  });

  it("falls back to the free-form generator when there are no atoms at all", async () => {
    const callAIJSON = vi.fn().mockResolvedValue({ questions: [] });
    await startObjectiveQuiz(
      {
        objectives: [{ id: "a", objective: "Describe the brachial plexus." }],
        lectureTitle: "Brachial Plexus and Upper Limb",
        blockId: "b1",
        lectures,
        atoms: [],
        userId: "u1",
      },
      { callAIJSON }
    );
    expect(callAIJSON.mock.calls[0][1]).not.toMatch(/one question per fact/i);
  });
});

describe("objective-first atom coverage", () => {
  it("distributes a 10-question lecture quiz evenly across two objectives", () => {
    const objectives = [{ id: "o1" }, { id: "o2" }];
    const atoms = Array.from({ length: 10 }, (_, index) => ({
      term: `fact-${index}`,
      content: `Fact ${index}`,
      objectiveIds: [index < 5 ? "o1" : "o2"],
    }));
    const selected = selectAtomsByObjectiveCoverage(atoms, objectives, {}, 10);
    expect(selected).toHaveLength(10);
    expect(selected.filter((atom) => atom.objectiveIds.includes("o1"))).toHaveLength(5);
    expect(selected.filter((atom) => atom.objectiveIds.includes("o2"))).toHaveLength(5);
  });

  it("excludes supplemental student material from school-style exemplars", () => {
    const banks = {
      official: [{ stem: "Official?", choices: { A: "Yes" }, sourceKind: "school" }],
      natalie: [{ stem: "Student note?", choices: { A: "Yes" }, sourceKind: "supplemental" }],
    };
    const meta = {
      a: { filename: "official", blockId: "dm", sourceKind: "school" },
      b: { filename: "natalie", blockId: "dm", sourceKind: "supplemental" },
    };
    expect(selectExemplarsForBlock(banks, meta, "dm").map((q) => q.stem)).toEqual(["Official?"]);
  });
});

describe("resolveDefaultDifficulty", () => {
  it("starts at medium with no prior accuracy", () => {
    expect(resolveDefaultDifficulty(null)).toBe("medium");
    expect(resolveDefaultDifficulty(undefined)).toBe("medium");
  });

  it("stays medium below the 80% mastery threshold", () => {
    expect(resolveDefaultDifficulty(0)).toBe("medium");
    expect(resolveDefaultDifficulty(0.79)).toBe("medium");
  });

  it("bumps to hard at 80% cumulative accuracy", () => {
    expect(resolveDefaultDifficulty(0.8)).toBe("hard");
    expect(resolveDefaultDifficulty(0.85)).toBe("hard");
  });

  it("bumps to expert at 90% cumulative accuracy", () => {
    expect(resolveDefaultDifficulty(0.9)).toBe("expert");
    expect(resolveDefaultDifficulty(1)).toBe("expert");
  });
});
