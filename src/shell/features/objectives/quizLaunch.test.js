import { beforeEach, describe, expect, it, vi } from "vitest";
import { installDomStorage } from "../../../stores/testEnv.js";
import {
  sortWeakestFirst,
  buildAdaptiveObjectivePlan,
  remainingObjectiveAllocation,
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
  selectClinicalExamplesForBlock,
  selectExemplarsForBlock,
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

  it("prioritizes struggling and developing objectives before untested or mastered ones", () => {
    expect(sortWeakestFirst([
      { id: "mastered", status: "mastered", consecutiveCorrect: 0 },
      { id: "developing", status: "developing", consecutiveCorrect: 0 },
      { id: "untested", status: "untested", consecutiveCorrect: 0 },
      { id: "struggling", status: "struggling", consecutiveCorrect: 4 },
    ]).map((objective) => objective.id)).toEqual(["struggling", "developing", "untested", "mastered"]);
  });

  it("concentrates a 15-question adaptive plan on struggling, then developing objectives", () => {
    const plan = buildAdaptiveObjectivePlan([
      ...Array.from({ length: 5 }, (_, index) => ({ id: `s${index + 1}`, status: "struggling" })),
      ...Array.from({ length: 3 }, (_, index) => ({ id: `d${index + 1}`, status: "developing" })),
      ...Array.from({ length: 4 }, (_, index) => ({ id: `u${index + 1}`, status: "untested" })),
    ], 15);
    const totals = plan.reduce((result, objective) => ({
      ...result,
      [objective._adaptiveStatus]: (result[objective._adaptiveStatus] || 0) + objective._targetQuestionCount,
    }), {});
    expect(totals).toEqual({ struggling: 11, developing: 4 });
    expect(plan.reduce((sum, objective) => sum + objective._targetQuestionCount, 0)).toBe(15);
  });

  it("caps one struggling objective before adding developing work", () => {
    const plan = buildAdaptiveObjectivePlan([
      { id: "repair", status: "struggling" },
      { id: "develop", status: "developing" },
      { id: "new", status: "untested" },
    ], 5);
    expect(plan.map((objective) => [objective.id, objective._targetQuestionCount])).toEqual([
      ["repair", 3], ["develop", 2],
    ]);
  });

  it("keeps an explicit exam-coverage focus ahead of the general weakness order", () => {
    expect(sortWeakestFirst([
      { id: "repair", status: "struggling", _focusPriority: 1 },
      { id: "coverage", status: "untested", _focusPriority: 0 },
    ]).map((objective) => objective.id)).toEqual(["coverage", "repair"]);
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
    expect(config.objectives[0]._targetQuestionCount).toBe(1);
    expect(lectureId).toBe("lec1");
  });

  it("uses an exact lecture id hint instead of an ambiguous matching title", () => {
    const target = { id: "lec-target", blockId: "b1", lectureTitle: "Brachial Plexus and Upper Limb II", chunks: [{ markdown: "TARGET SOURCE " + LECTURE_BODY }] };
    const { config, lectureId } = buildQuizConfig({
      objectives: [{ id: "o-target", linkedLecId: "lec-target", objective: "Target objective." }],
      lectureTitle: "Brachial Plexus and Upper Limb",
      lectureIdHint: "lec-target",
      blockId: "b1",
      lectures: [lectures[0], target],
      questionCount: 1,
    });
    expect(lectureId).toBe("lec-target");
    expect(config.lectureText).toContain("TARGET SOURCE");
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

describe("curriculum-wide exemplars", () => {
  beforeEach(() => installDomStorage());

  it("returns ExamSoft and IMCQ exemplars from every uploaded block", () => {
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
    expect(result.map((question) => question.stem)).toEqual(["B1 Q?", "B2 Q?"]);
  });

  it("still uses an earlier block when the active block has no upload", () => {
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
    expect(result.map((question) => question.stem)).toEqual(["B2 Q?"]);
  });

  it("scopes clinical prior-question evidence to the active block", () => {
    const examples = [
      { stem: "DM question", choices: { A: "a" }, blockId: "dm" },
      { stem: "ER question", choices: { A: "a" }, blockId: "er" },
    ];
    expect(selectClinicalExamplesForBlock(examples, "dm").map((q) => q.stem)).toEqual(["DM question"]);
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
  it("merges overlapping parallel outputs once without exceeding the requested count", async () => {
    const question = { stem: "A patient develops reduced gastric acid secretion after a histamine receptor antagonist. Which signaling mechanism accounts for this finding?",
      choices: { A: "Reduced cyclic AMP", B: "Increased calcium", C: "Nuclear transcription", D: "Increased chloride transport" }, correct: "A" };
    const onAccepted = vi.fn();
    const callAIJSON = vi.fn().mockResolvedValue({ questions: [question] });
    const result = await prepareObjectiveQuiz(
      { objectives: [], atoms: [{ term: "Histamine", content: "Histamine stimulates cyclic AMP in parietal cells." }], questionCount: 10 },
      { callAIJSON, prepareConcurrency: 2, maxPrepareAttempts: 2, skipQuestionAudit: true, onAccepted }
    );
    expect(result.questions).toHaveLength(1);
    expect(onAccepted).toHaveBeenCalledTimes(1);
    expect(callAIJSON).toHaveBeenCalledTimes(2);
  });

  it("starts two independent batches before awaiting either and preserves provider errors", async () => {
    const pending = [];
    const callAIJSON = vi.fn().mockImplementation(() => new Promise(resolve => pending.push(resolve)));
    const preparation = prepareObjectiveQuiz(
      { objectives: [], atoms: [{ term: "Source", content: "Lecture evidence." }], questionCount: 10 },
      { callAIJSON, prepareConcurrency: 2, maxPrepareAttempts: 2, skipQuestionAudit: true }
    );
    expect(callAIJSON).toHaveBeenCalledTimes(2);
    for (const resolve of pending) resolve({ error: "provider unavailable" });
    const result = await preparation;
    expect(result.questions).toEqual([]);
    expect(result.error).toMatch(/provider unavailable/);
    expect(result.incomplete).toBe(true);
  });

  it("tries later objectives when the first group produces no usable questions", async () => {
    const objectives = Array.from({ length: 15 }, (_, index) => ({
      id: `rotation-${index + 1}`, objective: `Explain source relationship ${index + 1}.`,
    }));
    const callAIJSON = vi.fn().mockResolvedValue({ questions: [] });
    const result = await prepareObjectiveQuiz(
      { objectives, atoms: [{ term: "Source", content: "Lecture evidence." }], questionCount: 15, generationVersion: "v2" },
      { callAIJSON, skipQuestionAudit: true }
    );
    expect(result.incomplete).toBe(true);
    const prompts = callAIJSON.mock.calls.map(call => call[1]);
    expect(prompts[0]).toContain("[rotation-1]");
    expect(prompts[1]).toContain("[rotation-6]");
    expect(prompts[2]).toContain("[rotation-11]");
    expect(callAIJSON).toHaveBeenCalledTimes(3);
  });

  it.each([[4, 1], [2, 1], [4, 2]])("fills 15 slots with %i candidates per round and concurrency %i", async (yieldPerRound, prepareConcurrency) => {
    const contexts = [
      "postprandial intestinal motility after vagal stimulation",
      "sphincter contraction after sympathetic discharge",
      "pancreatic secretion following cholecystokinin release",
      "gastric accommodation after a meal",
      "colonic mass movement after waking",
      "salivary secretion during parasympathetic activation",
      "biliary emptying after a fatty meal",
      "small-bowel peristalsis after luminal distention",
      "gastric acid secretion after histamine exposure",
      "ileocecal valve tone during sympathetic activation",
      "rectal relaxation during the defecation reflex",
      "intestinal blood flow after local metabolite accumulation",
      "submucosal secretion after mucosal stimulation",
      "myenteric contraction after stretch",
      "lower esophageal sphincter relaxation during swallowing",
    ];
    const objectives = contexts.map((context, index) => ({
      id: `o${index + 1}`,
      objective: `Explain ${context}.`,
    }));
    const made = (index) => ({
      stem: `An investigator measures ${contexts[index]} while intrinsic enteric circuits remain intact. Which neural mechanism most directly accounts for this observation?`,
      choices: { A: `Supported route ${index}A`, B: `Alternative route ${index}B`, C: `Adjacent route ${index}C`, D: `Unrelated route ${index}D` },
      correct: "A",
      explanation: `Supported route ${index}A directly explains ${contexts[index]} using the supplied autonomic mechanism.`,
      objectiveIds: [`o${index + 1}`],
    });
    let round = 0;
    const callAIJSON = vi.fn().mockImplementation(() => {
      const start = round * yieldPerRound;
      round += 1;
      return { questions: contexts.slice(start, start + yieldPerRound).map((_, offset) => made(start + offset)) };
    });
    const result = await prepareObjectiveQuiz(
      { objectives, atoms: [{ term: "Mechanism", content: "A supported mechanism." }], questionCount: 15 },
      { callAIJSON, skipQuestionAudit: true, prepareConcurrency }
    );
    expect(callAIJSON).toHaveBeenCalledTimes(Math.ceil(15 / yieldPerRound));
    expect(result.questions).toHaveLength(15);
    expect(result.incomplete).toBe(false);
  });

  it("allows repeated questions for the same objective when the stems and concepts differ", async () => {
    const questions = [
      { stem: "A receptor mutation changes the first messenger response. Which mechanism explains the finding?", choices: { A: "Gs activation", B: "Gi inhibition", C: "Ion channel opening", D: "Nuclear binding" }, correct: "A", objectiveIds: ["o1"], topic: "receptor signaling" },
      { stem: "After a meal, a patient has delayed enzyme secretion despite normal hormone levels. Which pathway is impaired?", choices: { A: "Vagal reflex", B: "Bile storage", C: "Pancreatic duct response", D: "Gastric accommodation" }, correct: "C", objectiveIds: ["o1"], topic: "postprandial secretion" },
      { stem: "A transporter is blocked at the apical membrane, reducing nutrient uptake. Which consequence follows?", choices: { A: "Lower portal delivery", B: "Increased filtration", C: "Reduced ventilation", D: "Higher muscle uptake" }, correct: "A", objectiveIds: ["o1"], topic: "apical transport" },
    ];
    const result = await prepareObjectiveQuiz(
      { objectives: [{ id: "o1", objective: "Explain one." }], atoms: [{ term: "Fact", content: "One fact." }], questionCount: 3 },
      { callAIJSON: vi.fn().mockResolvedValue({ questions }), skipQuestionAudit: true }
    );
    expect(result.incomplete).toBe(false);
    expect(result.questions).toHaveLength(3);
  });

  it("fills the requested count with distinct applications of a repeated topic", async () => {
    const questions = [
      "A patient with the first clinical presentation is evaluated. Which mechanism best explains the finding?",
      "A patient with a second clinical presentation is evaluated. Which mechanism best explains the finding?",
      "A patient with a third clinical presentation is evaluated. Which mechanism best explains the finding?",
    ].map((stem, index) => ({
      stem,
      choices: { A: "Mechanism A", B: "Mechanism B", C: "Mechanism C", D: "Mechanism D" },
      correct: "A",
      objectiveIds: ["o1"],
      topic: "shared metabolic pathway",
      explanation: `Application ${index + 1}.`,
    }));
    const result = await prepareObjectiveQuiz(
      { objectives: [{ id: "o1", objective: "Apply one pathway." }], atoms: [{ term: "Pathway", content: "One fact." }], questionCount: 3 },
      { callAIJSON: vi.fn().mockResolvedValue({ questions }), skipQuestionAudit: true }
    );
    expect(result.incomplete).toBe(false);
    expect(result.questions).toHaveLength(3);
  });

  it("reports a shortfall instead of launching generic substitutes", async () => {
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
      { callAIJSON, skipQuestionAudit: true },
      (entry) => progress.push(entry)
    );
    expect(result.questions).toHaveLength(1);
    expect(result.incomplete).toBe(true);
    expect(progress.at(-1)).toMatchObject({ ready: 1, requested: 3 });
  });

  it("reports a provider failure without grounded recall substitution", async () => {
    const callAIJSON = vi.fn().mockRejectedValue(new Error("provider unavailable"));
    const result = await prepareObjectiveQuiz(
      { objectives: [{ id: "o1", objective: "Explain one." }], atoms: [{ term: "Fact", content: "One fact." }], questionCount: 10 },
      { callAIJSON, maxPrepareAttempts: 1, skipQuestionAudit: true }
    );
    expect(result.incomplete).toBe(true);
    expect(result.questions).toEqual([]);
    expect(result.error).toMatch(/Only 0\/10.*provider unavailable/);
  });

  it("reports V2 provider failure without publishing recall substitutes", async () => {
    const onAccepted = vi.fn();
    const result = await prepareObjectiveQuiz(
      { objectives: [{ id: "o1", objective: "Explain one." }], atoms: [{ term: "Fact", content: "One fact." }], questionCount: 10, generationVersion: "v2" },
      { callAIJSON: vi.fn().mockRejectedValue(new Error("provider unavailable")), onAccepted }
    );
    expect(result.incomplete).toBe(true);
    expect(result.questions).toEqual([]);
    expect(result.error).toMatch(/Only 0\/10.*provider unavailable/);
    expect(onAccepted).not.toHaveBeenCalled();
  });

  it("keeps accepted V2 questions when retries run short without filling with recall", async () => {
    const onAccepted = vi.fn();
    const callAIJSON = vi.fn()
      .mockResolvedValueOnce({ questions: [{ stem: "Which pathway accounts for the supplied findings?", choices: { A: "One", B: "Two", C: "Three", D: "Four" }, correct: "A" }] })
      .mockRejectedValue(new Error("provider unavailable"));
    const result = await prepareObjectiveQuiz(
      { objectives: [], atoms: [{ term: "Fact", content: "One fact." }], questionCount: 2, generationVersion: "v2" },
      { callAIJSON, onAccepted, skipQuestionAudit: true }
    );
    expect(result.incomplete).toBe(true);
    expect(result.questions).toHaveLength(1);
    expect(result.questions[0].generationVersion).toBe("v2");
    expect(result.questions[0].generationMode).not.toBe("grounded-fallback");
    expect(onAccepted).toHaveBeenCalledOnce();
    expect(callAIJSON).toHaveBeenCalledTimes(2);
  });

  it("shares a preparation deadline across calls and stops refill after it expires", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1000);
    const callAIJSON = vi.fn().mockImplementation(async (...params) => {
      expect(params[6].timeoutMs).toBe(100);
      now.mockReturnValue(1101);
      return { questions: [] };
    });
    try {
      const result = await prepareObjectiveQuiz(
        { objectives: [], atoms: [{ term: "Fact", content: "One fact." }], questionCount: 2, generationVersion: "v2" },
        { callAIJSON, maxPreparationMs: 100, skipQuestionAudit: true }
      );
      expect(callAIJSON).toHaveBeenCalledOnce();
      expect(result.incomplete).toBe(true);
      expect(result.reason).toMatch(/time budget/);
    } finally {
      now.mockRestore();
    }
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
    expect(result.warning).toMatch(/Starting with 9 prepared questions/);
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
    expect(result.incomplete).toBe(true);
    expect(result.questions.length).toBeGreaterThan(0);
  });

  it("stops after three empty replacement rounds instead of grinding through every retry", async () => {
    const callAIJSON = vi.fn().mockResolvedValue({ questions: [] });
    const result = await prepareObjectiveQuiz(
      { objectives: [{ id: "o1", objective: "Explain one." }], atoms: [{ term: "Fact", content: "One fact." }], questionCount: 10 },
      { callAIJSON, skipQuestionAudit: true }
    );
    expect(result.incomplete).toBe(true);
    expect(callAIJSON).toHaveBeenCalledTimes(3);
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
    expect(result.questions.length).toBeGreaterThan(0);
    expect(callAIJSON).toHaveBeenCalled();
    expect(callAIJSON.mock.calls.every((call) => (call[1].match(/^\d+\. \[/gm) || []).length <= 5)).toBe(true);
  });
});

describe("startObjectiveQuiz — objective-driven with atom evidence", () => {
  beforeEach(() => installDomStorage());

  const atoms = [
    { type: "definition", term: "Thyroglobulin", content: "Scaffold protein for T3/T4 synthesis." },
    { type: "relationship", term: "Pendrin", content: "Apical iodide/chloride exchanger." },
  ];

  it("uses the objective generator when atoms are available", async () => {
    const callAIJSON = vi.fn().mockResolvedValue({
      questions: [
        { stem: "A slide shows a thyroid follicle...?", choices: { A: "Thyroglobulin", B: "x", C: "y", D: "z" }, correct: "A" },
      ],
    });
    const result = await startObjectiveQuiz(
      { objectives: [], lectureTitle: "Thyroid", blockId: "b1", lectures: [], atoms, questionCount: 1, userId: "u1", lectureIdHint: "lec1" },
      { callAIJSON, skipQuestionAudit: true }
    );
    expect(callAIJSON.mock.calls[0][1]).toMatch(/KEY FACTS EXTRACTED FROM THE LECTURE/i);
    expect(callAIJSON.mock.calls[0][1]).toMatch(/Thyroglobulin/);
    expect(result.questions[0].atomKey).toBeNull();
  });

  it("keeps the evidence window bounded without atom mastery ordering", async () => {
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
    const prompt = callAIJSON.mock.calls[0][1];
    expect(prompt).toContain("Thyroglobulin");
    expect(prompt).not.toContain("Pendrin");
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
    expect(prompt).toContain("[SOM-10] Explain objective 10.");
    expect(prompt).not.toContain("[SOM-11]");
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

  it("restores source identity from upload metadata for older bank rows", () => {
    const result = selectExemplarsForBlock({ "old-bank": [{ stem: "Case?", choices: { A: "Yes" } }] }, {
      upload: { filename: "old-bank", sourceKind: "supplemental", blockId: "nb" },
    }, "nb");
    expect(result[0]).toMatchObject({ sourceFile: "old-bank", sourceKind: "supplemental", blockId: "nb" });
  });

  it("keeps supplemental student material available for task-pattern evidence", () => {
    const banks = {
      official: [{ stem: "Official?", choices: { A: "Yes" }, sourceKind: "school" }],
      natalie: [{ stem: "Student note?", choices: { A: "Yes" }, sourceKind: "supplemental" }],
    };
    const meta = {
      a: { filename: "official", blockId: "dm", sourceKind: "school" },
      b: { filename: "natalie", blockId: "dm", sourceKind: "supplemental" },
    };
    expect(selectExemplarsForBlock(banks, meta, "dm").map((q) => q.stem)).toEqual(["Official?", "Student note?"]);
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

describe("live evidence allocation", () => {
  it("does not spend intensive slots on ready objectives while gaps remain", () => {
    expect(buildAdaptiveObjectivePlan([{ id: "easy", status: "ready" }, { id: "gap", status: "developing" }], 5).map(row => row.id)).toEqual(["gap"]);
  });
  it("preserves per-objective quotas across generation and reserve batches", () => {
    const plan = [{ id: "gap", _targetQuestionCount: 3 }, { id: "new", _targetQuestionCount: 2 }];
    const batch = remainingObjectiveAllocation(plan, [{ objectiveIds: ["gap"] }, { objectiveIds: ["gap"] }], 3);
    expect(batch.map(row => [row.id, row._targetQuestionCount])).toEqual([["gap", 1], ["new", 2]]);
  });
  it("builds the same plan as the evidence panel instead of trusting stale status", () => {
    const result = buildQuizConfig({ objectives: [{ id: "easy", status: "struggling" }, { id: "gap", status: "mastered" }], questionCount: 5,
      atoms: [{ term: "Source", content: "Source-supported relationship" }], evidenceModel: { objectives: {
        easy: { attempts: 3, correct: 3, recent: [true], sessions: ["one", "two"], taskTypes: { mechanism: 2, recognition: 1 } },
        gap: { attempts: 3, correct: 1, recent: [false], sessions: ["one"], taskTypes: { mechanism: 3 } },
      } } });
    expect(result.config.objectives.map(objective => objective.id)).toEqual(["gap"]);
    expect(result.config.requireReasoningAudit).toBe(true);
    expect(result.config.orderBlueprint.targets["first-order"]).toBe(0);
  });
});
