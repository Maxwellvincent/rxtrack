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
  buildGroundedRecallQuestions,
  startObjectiveQuiz,
  prepareObjectiveQuiz,
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
      { callAIJSON, skipQuestionAudit: true }
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
      { callAIJSON, skipQuestionAudit: true }
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
      { callAIJSON, skipQuestionAudit: true }
    );
    expect(result.error).toBe("model down");
    expect(result.questions).toEqual([]);
  });
});

describe("prepareObjectiveQuiz", () => {
  it("refills rejected slots instead of launching a partial quiz", async () => {
    const made = (label) => ({ stem: `${label}?`, choices: { A: "One", B: "Two", C: "Three", D: "Four" }, correct: "A" });
    const callAIJSON = vi.fn()
      .mockResolvedValueOnce({ questions: [made("Q1"), made("Q2"), made("Q3")] })
      .mockResolvedValueOnce({ reviews: [
        { index: 0, approved: true, issues: [] },
        { index: 1, approved: false, issues: ["weak_explanation"] },
        { index: 2, approved: true, issues: [] },
      ] })
      .mockResolvedValueOnce({ questions: [made("Q4")] })
      .mockResolvedValueOnce({ reviews: [{ index: 0, approved: true, issues: [] }] });
    const progress = [];
    const result = await prepareObjectiveQuiz(
      { objectives: [{ id: "o1", objective: "Explain one." }], atoms: [{ term: "Fact", content: "One fact." }], questionCount: 3 },
      { callAIJSON },
      (entry) => progress.push(entry)
    );
    expect(result.questions).toHaveLength(3);
    expect(result.incomplete).toBe(false);
    expect(progress.at(-1)).toMatchObject({ ready: 3, requested: 3, phase: "ready" });
  });

  it("fills a provider failure with grounded lecture questions", async () => {
    const callAIJSON = vi.fn().mockRejectedValue(new Error("provider unavailable"));
    const result = await prepareObjectiveQuiz(
      { objectives: [{ id: "o1", objective: "Explain one." }], atoms: [{ term: "Fact", content: "One fact." }], questionCount: 10 },
      { callAIJSON, maxPrepareAttempts: 1, skipQuestionAudit: true }
    );
    expect(result.incomplete).toBe(false);
    expect(result.questions).toHaveLength(10);
    expect(result.fallbackCount).toBe(10);
  });

  it("builds credit-independent questions only from uploaded facts", () => {
    const questions = buildGroundedRecallQuestions({
      atoms: [
        { term: "Insulin", content: "Promotes GLUT4 translocation in skeletal muscle.", objectiveIds: ["o1"] },
        { term: "Glucagon", content: "Promotes hepatic glycogenolysis.", objectiveIds: ["o2"] },
      ],
      count: 4,
    });
    expect(questions).toHaveLength(4);
    expect(questions.every((question) => question.generationMode === "grounded-fallback")).toBe(true);
    expect(questions.every((question) => question.qualityAudit.status === "source-grounded")).toBe(true);
    expect(questions.every((question) => question.explanation.includes(":"))).toBe(true);
    expect(questions.every((question) => !question.stem.includes(".?"))).toBe(true);
    expect(questions[0].stem).not.toContain("finding: Insulin promotes");
    expect(questions.every((question) => !/\b(?:a|the) lecture\b/i.test(question.stem))).toBe(true);
  });

  it("spreads fallback questions across distinct concepts before revisiting one", () => {
    const questions = buildGroundedRecallQuestions({
      atoms: [
        { term: "Insulin", content: "Increases GLUT4 translocation." },
        { term: "Insulin", content: "Inhibits hormone-sensitive lipase." },
        { term: "Glucagon", content: "Promotes hepatic glycogenolysis." },
      ],
      count: 3,
    });
    expect(questions.map((question) => question.topic)).toEqual(["Insulin", "Glucagon", "Insulin"]);
  });

  it("keeps searching grounded variants after early stems were already used", () => {
    const atoms = Array.from({ length: 7 }, (_, index) => ({
      term: `Fact ${index + 1}`,
      content: `Uploaded lecture statement ${index + 1}.`,
    }));
    const first = buildGroundedRecallQuestions({ atoms, count: 2 });
    const questions = buildGroundedRecallQuestions({
      atoms,
      count: 10,
      avoidStems: first.map((question) => question.stem),
    });
    expect(questions).toHaveLength(10);
    expect(questions.every((question) => !first.some((old) => old.stem === question.stem))).toBe(true);
  });

  it("returns a usable verified partial rather than blocking launch", async () => {
    const made = (label) => ({ stem: `A patient with ${label} syndrome presents after a distinct exposure causing ${label} laboratory abnormalities and ${label} physical findings. Additional testing confirms ${label} pathway dysfunction. Which mechanism best explains this ${label} presentation?`, choices: { A: `${label} mechanism`, B: `${label} receptor defect` }, correct: "A", explanation: "Because." });
    const routes = [
      "thyroid iodine organification", "adrenal cortisol synthesis", "pancreatic insulin secretion",
      "hepatic glycogen breakdown", "muscle glucose transport", "renal bicarbonate handling",
      "intestinal lipid absorption", "mitochondrial electron transfer", "pituitary prolactin inhibition",
    ];
    const atoms = [{ term: "Only fact", content: "Only uploaded statement." }];
    const exhaustedFallbackStems = buildGroundedRecallQuestions({ atoms, count: 10 }).map((question) => question.stem);
    const callAIJSON = vi.fn()
      .mockResolvedValueOnce({ questions: routes.map(made) })
      .mockResolvedValueOnce({ reviews: Array.from({ length: 9 }, (_, index) => ({ index, approved: true, issues: [] })) });
    const result = await prepareObjectiveQuiz(
      { objectives: [], atoms, questionCount: 10, avoidStems: exhaustedFallbackStems },
      { callAIJSON, maxPrepareAttempts: 1, skipQuestionAudit: true }
    );
    expect(result.error).toBeUndefined();
    expect(result.incomplete).toBe(true);
    expect(result.questions).toHaveLength(9);
    expect(result.warning).toMatch(/Starting with 9 verified questions/);
  });

  it("continues after a fully rejected replacement batch", async () => {
    const made = (label) => ({ stem: `A patient with ${label} syndrome presents after a distinct exposure causing ${label} laboratory abnormalities and ${label} physical findings. Additional testing confirms ${label} pathway dysfunction. Which mechanism best explains this ${label} presentation?`, choices: { A: `${label} mechanism`, B: `${label} receptor defect` }, correct: "A", explanation: "Because." });
    const callAIJSON = vi.fn()
      .mockResolvedValueOnce({ questions: [made("alpharoute")] })
      .mockResolvedValueOnce({ questions: [] })
      .mockResolvedValueOnce({ questions: [made("betaroute")] })
    const result = await prepareObjectiveQuiz(
      { objectives: [{ id: "o1", objective: "Explain one." }], atoms: [{ term: "Fact", content: "One fact." }], questionCount: 2 },
      { callAIJSON, maxPrepareAttempts: 3, skipQuestionAudit: true }
    );
    expect(result.incomplete).toBe(false);
    expect(result.questions.map((question) => question.topic).sort()).toEqual(["Fact", "Fact"]);
  });

  it("builds large reserves in five-question batches instead of one oversized response", async () => {
    let batch = 0;
    const callAIJSON = vi.fn().mockImplementation(async () => {
      const current = batch++;
      return {
        questions: Array.from({ length: current < 2 ? 10 : 5 }, (_, index) => ({
          stem: `A ${30 + index}-year-old patient presents with fatigue, weight change, and abnormal laboratory findings in generated batch ${current + 1}. Which mechanism best explains this presentation ${index + 1}?`,
          choices: { A: "Mechanism one", B: "Mechanism two", C: "Mechanism three", D: "Mechanism four", E: "Mechanism five" },
          correct: "A",
          explanation: "Mechanism one accounts for the findings.",
        })),
      };
    });
    const atoms = Array.from({ length: 25 }, (_, index) => ({ term: `Fact ${index + 1}`, content: `Grounded fact ${index + 1}.` }));
    const result = await prepareObjectiveQuiz(
      { objectives: [], atoms, questionCount: 25 },
      { callAIJSON, skipQuestionAudit: true }
    );
    expect(result.questions).toHaveLength(25);
    expect(callAIJSON).toHaveBeenCalledTimes(5);
    expect(callAIJSON.mock.calls.every((call) => (call[1].match(/^\d+\. \[/gm) || []).length <= 5)).toBe(true);
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
      { callAIJSON, skipQuestionAudit: true }
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
  it("fills a requested 10-question quiz from objectives when extraction has only 3 atoms", async () => {
    installDomStorage();
    const objectives = Array.from({ length: 12 }, (_, index) => ({
      id: `o${index + 1}`,
      code: `SOM-${index + 1}`,
      objective: `Explain objective ${index + 1}.`,
    }));
    const sparseAtoms = Array.from({ length: 3 }, (_, index) => ({
      type: "definition",
      term: `Atom ${index + 1}`,
      content: `Supporting fact ${index + 1}.`,
      objectiveIds: [`o${index + 1}`],
    }));
    const callAIJSON = vi.fn().mockResolvedValue({ questions: [] });

    await startObjectiveQuiz(
      { objectives, lectureTitle: "Sparse lecture", blockId: "dm", atoms: sparseAtoms, questionCount: 10 },
      { callAIJSON }
    );

    const prompt = callAIJSON.mock.calls[0][1];
    expect(prompt).toContain("10. [objective]");
    expect(prompt).not.toContain("11. [objective]");
  });

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
