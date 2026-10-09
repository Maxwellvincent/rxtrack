import { describe, it, expect } from "vitest";
import { vi } from "vitest";
import { explanationOnlyReplacement, questionMatchesObjectiveDomain, normalizeQuestions, buildMcqPrompt, generateMcqs, buildExemplarParsePrompt, parseExemplarsFromMd, buildAtomQuestionsPrompt, generateFromAtoms, selectStyleExemplars, exemplarSourceTier, buildQuestionAuditPrompt, auditGeneratedQuestions, locallyValidClinicalQuestions, locallyUsableQuestions, buildStyleFingerprint, questionEndingTask, diversifyQuestionEndings, buildQuestionSourceBlueprint, styleProfilePrompt } from "./mcq.js";

describe("normalizeQuestions", () => {
  const good = {
    stem: "A 45-year-old man presents with polyuria and polydipsia. Which hormone is deficient?",
    choices: { A: "Insulin", B: "Glucagon", C: "Cortisol", D: "TSH" },
    correct: "A",
    explanation: "Type 1 DM = insulin deficiency.",
  };

  it("accepts a valid MCQ and keeps the correct letter pointing at the right answer", () => {
    // Asserted by text, not by letter: normalize shuffles the options on purpose, so the letter
    // is expected to move and only the answer it points at is stable.
    const out = normalizeQuestions({ questions: [{ ...good, correct: "a" }] });
    expect(out).toHaveLength(1);
    expect(out[0].choices[out[0].correct]).toBe("Insulin");
  });
  it("keeps the generated order label and Bloom level", () => {
    const [out] = normalizeQuestions([{ ...good, orderLevel: "third order", bloomLevel: 4 }]);
    expect(out.orderLevel).toBe("third-order");
    expect(out.bloomLevel).toBe(4);
  });
  it("preserves the objective facet label for later analysis", () => {
    const [out] = normalizeQuestions([{ ...good, objectiveFacet: "neurotransmitter synthesis" }]);
    expect(out.objectiveFacet).toBe("neurotransmitter synthesis");
  });
  it("accepts a bare array too", () => {
    expect(normalizeQuestions([good])).toHaveLength(1);
  });
  it("drops questions whose correct letter isn't among the choices", () => {
    expect(normalizeQuestions([{ ...good, correct: "E" }])).toHaveLength(0);
  });
  it("drops questions with no stem, or fewer than 2 choices", () => {
    expect(normalizeQuestions([{ ...good, stem: "" }])).toHaveLength(0);
    expect(normalizeQuestions([{ ...good, choices: { A: "only one" } }])).toHaveLength(0);
  });
  it("tolerates garbage", () => {
    expect(normalizeQuestions(null)).toEqual([]);
    expect(normalizeQuestions([1, null, "x"])).toEqual([]);
  });
  it("repairs decorated letters and trusts one explicit correct-option rationale over a conflicting key", () => {
    const [question] = normalizeQuestions([{
      ...good,
      choices: { "* A": "Insulin", "✓ B": "Glucagon", C: "Cortisol", D: "TSH" },
      correct: "A and B",
      whyWrong: { A: "Tempting, but not correct here.", B: "Correct — this is the keyed mechanism." },
    }]);
    expect(question.choices[question.correct]).toBe("Glucagon");
  });
});

describe("styleProfilePrompt", () => {
  it("passes source option patterns and objective-constrained report weaknesses to generation", () => {
    const prompt = styleProfilePrompt({
      sampleSize: 30,
      optionCounts: { 4: 2, 5: 16, 6: 10, 7: 1, 8: 1 },
      officialStyle: { sampleSize: 30, optionCountDistribution: [{ options: 4, count: 2 }, { options: 5, count: 16 }, { options: 6, count: 10 }, { options: 7, count: 1 }, { options: 8, count: 1 }], medianStemWords: 82, medianSentences: 4 },
      reportOutcomePerformance: [{ label: "Gross Anatomy & Embryology", attempts: 4, correct: 1, accuracy: 25 }],
    }, 30);
    expect(prompt).toContain('"5":16');
    expect(prompt).toContain("Gross Anatomy & Embryology");
    expect(prompt).toContain("these only when they map to the requested lecture objectives");
    expect(prompt).toContain("Do not default every item to five choices");
    expect(prompt).toContain("scaled verified ExamSoft option-count quota");
    expect(prompt).toContain('[{"options":4,"count":2},{"options":5,"count":16},{"options":6,"count":10},{"options":7,"count":1},{"options":8,"count":1}]');
    expect(prompt).toContain("aggregate stem length and sentence-count profile");
    expect(prompt).toContain("plausible homogeneous distractors");
  });

  it("keeps the generation payload compact when the stored report has many outcomes", () => {
    const prompt = styleProfilePrompt({
      version: 3,
      sampleSize: 1791,
      sourceCounts: { examsoft: 1400, homework: 391 },
      optionCounts: { 5: 1791 },
      officialStyle: { sampleSize: 1400, medianStemWords: 72, medianSentences: 4, optionCountDistribution: [{ options: 5, count: 1400 }] },
      homeworkStyle: { sampleSize: 391, medianStemWords: 58 },
      clickerStyle: { sampleSize: 0 },
      reportOutcomePerformance: Array.from({ length: 300 }, (_, index) => ({
        label: `Outcome ${index + 1} with a long curriculum description`,
        attempts: 1,
        correct: 1,
        accuracy: 100,
      })),
    }, 5);
    expect(prompt).not.toContain("Outcome 300");
    expect(prompt.length).toBeLessThan(4000);
  });
});

describe("buildMcqPrompt", () => {
  it("compacts repeated school examples while retaining objective and factual contracts", () => {
    const cfg = { subject: "Synapses", count: 5, lectureText: "Synapses release neurotransmitter after calcium entry. ".repeat(100),
      objectives: [{ id: "synapse", code: "SOM.NB.8", objective: "Explain release of neurotransmitter", _targetOrder: "third-order", _targetQuestionCount: 2 }],
      atoms: [{ term: "Calcium entry", content: "Calcium entry triggers vesicle fusion.", exceptions: ["Electrical synapses transmit ions directly."] }],
      examples: Array.from({ length: 12 }, (_, i) => ({ sourceKind: "examsoft", stem: `Case ${i}: ${"A distinct clinical finding. ".repeat(20)} Which synaptic process explains the observation?`, choices: { A: "Calcium influx", B: "Sodium efflux", C: "Vesicle depletion", D: "Gap junction" }, correct: "A" })) };
    const full = buildMcqPrompt(cfg);
    const compact = buildMcqPrompt({ ...cfg, promptProfile: "compact" });
    expect(compact.length).toBeLessThan(full.length * 0.75);
    expect(compact).toContain("SOM.NB.8");
    expect(compact).toContain("Calcium entry triggers vesicle fusion.");
    expect(compact).toContain("Electrical synapses transmit ions directly.");
    expect(compact).toContain('"targetOrder":"third-order"');
    expect(compact).toContain('"targetCount":2');
    expect(compact).toContain("one unambiguous best answer");
  });
  const prompt = buildMcqPrompt({
    subject: "Endocrine hormones",
    lectureText: "Insulin is an anabolic hormone secreted by beta cells.",
    difficulty: "hard",
    count: 5,
    examples: [
      { stem: "A patient with X...?", choices: { A: "a", B: "b", C: "c", D: "d" }, correct: "B", explanation: "because" },
    ],
    objectives: [{ code: "SOM.1", objective: "Describe insulin secretion" }],
  });

  it("injects the exam-bank examples as style exemplars", () => {
    expect(prompt).toMatch(/EXAM BANK|EXAMPLE/i);
    expect(prompt).toContain("A patient with X");
  });

  it("requires varied school-style task endings and mostly second-order reasoning", () => {
    expect(prompt).toContain("QUESTION-TASK VARIATION");
    expect(prompt).toMatch(/at least 60%/);
    expect(prompt).toMatch(/downstream consequence/);
    expect(prompt).toMatch(/final task family/i);
  });

  it("uses a longer ExamSoft plus STEP 1 vignette blueprint for clinical application", () => {
    expect(prompt).toMatch(/ExamSoft-structured, STEP 1-style clinical/i);
    expect(prompt).toMatch(/clinical-application or third-order items, target 4–6 sentences/i);
    expect(prompt).toMatch(/timeline.*discriminating symptoms/i);
  });
  it("grounds the ExamSoft blueprint in observed DM/ER stem and distractor patterns", () => {
    expect(prompt).toContain("three linked moves");
    expect(prompt).toContain("near-neighbors in the same semantic category");
    expect(prompt).toContain("default to 5 options");
    expect(prompt).toContain("do not invent image dependence");
    expect(prompt).toContain("Madcow items are useful");
  });

  it("tells later generations not to repeat previously used stems", () => {
    const prompt = buildAtomQuestionsPrompt({
      atoms: [{ type: "definition", term: "Insulin", content: "Lowers serum glucose." }],
      difficulty: "expert",
      avoidStems: ["A 52-year-old man has fasting glucose of 210 mg/dL. What is the diagnosis?"],
    });
    expect(prompt).toContain("QUESTIONS ALREADY USED");
    expect(prompt).toContain("do not repeat, paraphrase, or test the same clue-to-answer route");
    expect(prompt).toContain("3+ reasoning steps");
  });
  it("requires atom-targeted questions to use full clinical vignettes rather than recall templates", () => {
    const atomPrompt = buildAtomQuestionsPrompt({
      atoms: [{ type: "definition", term: "Insulin", content: "Lowers serum glucose." }],
      objectives: [{ id: "o1", objective: "Explain insulin function, deficiency, manifestations, and management." }],
      difficulty: "medium",
    });
    expect(atomPrompt).toContain("realistic 3-5 sentence clinical vignette");
    expect(atomPrompt).toContain("1–2 reasoning steps");
    expect(atomPrompt).toContain("do not mention a lecture or learning objective");
    expect(atomPrompt).toContain("reject and rewrite any draft");
    expect(atomPrompt).toContain("OBJECTIVE FACET COVERAGE");
    expect(atomPrompt).toContain("multiple questions, each with the SAME single primary objective ID");
  });
  it("includes lecture content, objectives, difficulty and count", () => {
    expect(prompt).toContain("Insulin is an anabolic hormone");
    expect(prompt).toContain("Describe insulin secretion");
    expect(prompt).toMatch(/HARD/);
    expect(prompt).toContain("5");
    expect(prompt).toContain("OBJECTIVE FACET COVERAGE");
    expect(prompt).toContain("objectiveFacet");
  });
  it("keeps modality breadth named by an objective", () => {
    const modalityPrompt = buildMcqPrompt({
      objectives: [{ id: "o1", objective: "Identify GI blood supply in CT, MRI, and radiological images." }],
      atoms: [{ term: "IMA", content: "Supplies the distal colon." }],
      count: 3,
    });
    expect(modalityPrompt).toContain("OBJECTIVE MODALITY / SETTING COVERAGE");
    expect(modalityPrompt).toContain("CT, MRI, radiograph/radiologic imaging");
    expect(modalityPrompt).toContain("do not let every item collapse onto the first modality");
  });
  it("passes recurring lecture and uploaded-question clinical signals to generation", () => {
    const clinicalPrompt = buildMcqPrompt({
      lectureText: "A lecture fact about enzyme deficiency.",
      clinicalCorrelateLibrary: [{ label: "family history", frequency: 2, sourceKinds: ["lecture", "homework"] }],
    });
    expect(clinicalPrompt).toContain("RECURRENT CLINICAL CORRELATES");
    expect(clinicalPrompt).toContain("family history");
    expect(clinicalPrompt).toContain("outside facts");
  });
  it("uses Homework as task evidence without promoting it to official style", () => {
    const prompt = buildMcqPrompt({
      lectureText: "A lecture fact about enzyme regulation. ".repeat(8),
      objectives: [{ id: "o1", bloom_level: 4, objective: "Analyze pathway regulation" }],
      examples: [{ sourceKind: "supplemental", sourceFile: "Homework Week 2.pdf", stem: "A patient has a pathway defect. What downstream laboratory finding is expected?", choices: { A: "a", B: "b", C: "c", D: "d" }, correct: "A" }],
    });
    expect(prompt).toContain("HOMEWORK TASK EVIDENCE");
    expect(prompt).toContain("not official style or answer authority");
    expect(prompt).toContain("ORDER-OF-REASONING BLUEPRINT");
  });
  it("asks for strict JSON with the questions shape", () => {
    expect(prompt).toMatch(/"questions"/);
    expect(prompt).toMatch(/stem/);
    expect(prompt).toMatch(/choices/);
  });
});

describe("question ending analysis", () => {
  it("distinguishes the target of a Which stem from its shared opening", () => {
    expect(questionEndingTask("Which mechanism best explains the patient's findings?")).toBe("mechanism");
    expect(questionEndingTask("What additional laboratory finding would be expected?")).toBe("prediction");
    expect(questionEndingTask("A patient has decreased serum glucose. Which enzyme is most likely deficient?")).toBe("identification");
    expect(questionEndingTask("Which statement best describes the relationship between these abnormalities?")).toBe("relationship");
    expect(questionEndingTask("Which diagnosis is most likely?")).toBe("diagnosis");
  });

  it("records ending families and second-order signal in the style fingerprint", () => {
    const fingerprint = buildStyleFingerprint([
      { stem: "A patient has a defect. Which mechanism best explains the findings?", choices: { A: "a", B: "b" } },
      { stem: "A patient has a defect. What additional laboratory finding would be expected?", choices: { A: "a", B: "b" } },
      { stem: "A patient has a lesion. Which enzyme is deficient?", choices: { A: "a", B: "b" } },
    ]);
    expect(fingerprint.endingFamilies.map(({ family }) => family)).toEqual(expect.arrayContaining(["mechanism", "prediction", "identification"]));
    expect(fingerprint.secondOrderRate).toBeGreaterThanOrEqual(2 / 3);
    expect(fingerprint.medianStemWords).toBeGreaterThan(0);
    expect(fingerprint.medianSentences).toBeGreaterThan(0);
  });

  it("records the bank's data-format signals without treating them as factual authority", () => {
    const fingerprint = buildStyleFingerprint([
      { stem: "A patient has serum sodium 128 mEq/L after 3 days of symptoms. What finding is expected?", choices: { A: "a", B: "b" } },
      { stem: "The photomicrograph shows labeled seminiferous tubules. Which cell is indicated?", choices: { A: "a", B: "b" }, hasImage: true },
      { stem: "Compare the following values.", choiceLayout: "table", choices: { A: { Finding: "low" }, B: { Finding: "high" } } },
    ]);
    expect(fingerprint.formatSignals).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "laboratory-data", count: 1 }),
      expect.objectContaining({ label: "image-or-label", count: 1 }),
      expect.objectContaining({ label: "table", count: 1 }),
      expect.objectContaining({ label: "timeline", count: 1 }),
    ]));
  });

  it("retains every item while putting excess ending-family items after alternatives", () => {
    const questions = [
      "Which enzyme is deficient?",
      "Which enzyme is affected?",
      "Which hormone is secreted?",
      "Which structure is injured?",
      "What additional laboratory finding would be expected?",
    ].map((stem) => ({ stem }));
    const varied = diversifyQuestionEndings(questions);
    expect(varied).toHaveLength(5);
    expect(varied.some(({ stem }) => /additional laboratory/.test(stem))).toBe(true);
  });
});

describe("generated question scope checks", () => {
  const base = {
    stem: "A young adult is evaluated for a pathway disorder after several days of symptoms. Which metabolic change is most likely?",
    choices: { A: "Reduced amino acid breakdown", B: "Increased insulin secretion", C: "Increased bone turnover", D: "Reduced renal filtration" },
    correct: "A",
    explanation: "The pathway defect alters amino acid metabolism and reduces downstream breakdown.",
    objectiveIds: ["aa-objective"],
  };

  it("rejects generated questions with a grossly unrelated objective attribution", async () => {
    const nerveQuestion = {
      ...base,
      stem: "A patient sustains a penetrating injury to the forearm and cannot oppose the thumb. Which hand finding is most likely?",
      choices: { A: "Thenar weakness", B: "Foot drop", C: "Ptosis", D: "Loss of knee extension" },
      explanation: "A median nerve lesion affects thenar motor function and thumb opposition.",
    };
    expect(locallyUsableQuestions([nerveQuestion])).toHaveLength(1);
    await expect(auditGeneratedQuestions([nerveQuestion], {
      objectives: [{ id: "aa-objective", objective: "Analyze deficiencies in amino acid metabolic pathways associated with inborn errors of metabolism" }],
    }, { skipQuestionAudit: false, reviewAIJSON: vi.fn().mockResolvedValue({ reviews: [{ index: 0, approved: true, issues: [] }] }) })).resolves.toMatchObject({ questions: [] });
  });

  it("rejects a question that refers to a figure when no visual asset is attached", () => {
    const visualQuestion = { ...base, stem: "A figure showing pathway activity is provided. A patient has a metabolic disorder after several days. Which change is expected?" };
    expect(locallyUsableQuestions([visualQuestion])).toHaveLength(0);
  });

  it("keeps a grounded text-only item for its linked objective", async () => {
    expect(locallyUsableQuestions([base])).toHaveLength(1);
    await expect(auditGeneratedQuestions([base], {
      objectives: [{ id: "aa-objective", objective: "Analyze deficiencies in amino acid metabolic pathways associated with inborn errors of metabolism" }],
    }, { reviewAIJSON: vi.fn().mockResolvedValue({ reviews: [{ index: 0, approved: true, issues: [] }] }) })).resolves.toMatchObject({ questions: [{ stem: base.stem }] });
  });
});

describe("selectStyleExemplars", () => {
  const q = (stem, count, extra = {}) => ({
    stem,
    choices: Object.fromEntries("ABCDEFGH".slice(0, count).split("").map((letter) => [letter, letter])),
    ...extra,
  });

  it("returns separate official-style, Homework-task, and objective-order signals", () => {
    const blueprint = buildQuestionSourceBlueprint([
      q("Official school item", 4, { sourceFile: "ExamSoft.pdf", correct: "A" }),
      q("Homework item. What downstream finding is expected?", 4, { sourceFile: "Homework.pdf", correct: "A" }),
    ], [{ id: "o1", bloom_level: 4, objective: "Analyze this pathway" }], 5);
    expect(blueprint.officialStyle.sampleSize).toBe(1);
    expect(blueprint.homeworkTypes.sampleSize).toBe(1);
    expect(blueprint.order.targets["third-order"]).toBe(1);
  });

  it("keeps ExamSoft first and admits verified IMCQ as a style reference", () => {
    const examsoft = q("ExamSoft quiz", 5, { correct: "A", sourceFile: "BPM2_ESOFT_Quiz.pdf" });
    const school = q("School quiz", 4, { correct: "A", sourceFile: "Faculty quiz.pdf" });
    const imcq = q("IMCQ", 5, { sourceKind: "imcq", answerKeyVerified: true, correct: "A" });
    const unverified = q("Unverified", 5, { sourceKind: "imcq", answerKeyVerified: false });
    expect(selectStyleExemplars([school, imcq, examsoft, unverified], 3, "expert")).toEqual([examsoft, school, imcq]);
    expect(selectStyleExemplars([imcq, school, examsoft], 3, "medium")).toEqual([examsoft, school, imcq]);
    expect(selectStyleExemplars([school], 0)).toEqual([]);
    expect(buildAtomQuestionsPrompt({ examples: [imcq], difficulty: "expert" })).toContain("IMCQ challenge reference");
    expect(buildMcqPrompt({ examples: [imcq], difficulty: "expert" })).toContain("not calibrated");
  });

  it("uses homework only as content evidence, never as a style exemplar", () => {
    const homework = q("Assigned practice", 5, { correct: "A", sourceFile: "ER Week 2 Practice Questions.pdf" });
    const examsoft = q("ExamSoft", 5, { correct: "A", sourceFile: "ExamsoftPractice Questions.pdf" });
    expect(exemplarSourceTier(homework)).toBe("homework");
    expect(exemplarSourceTier(examsoft)).toBe("examsoft");
    expect(selectStyleExemplars([homework, examsoft], 5)).toEqual([examsoft]);
  });

  it("represents the school's different option counts and excludes unusable image-only examples", () => {
    const selected = selectStyleExemplars([
      q("four-1", 4), q("four-2", 4), q("five", 5), q("six", 6), q("seven", 7),
      q("image", 8, { hasImage: true }), q("eight", 8),
    ]);
    expect(selected.map((item) => Object.keys(item.choices).length)).toEqual([4, 5, 6, 7, 8]);
    expect(selected.map((item) => item.stem)).not.toContain("image");
  });

  it("uses the larger bank for style statistics instead of truncating at five", () => {
    const bank = Array.from({ length: 60 }, (_, index) =>
      q(`ExamSoft item ${index}`, 4, { sourceFile: "ExamSoft.pdf", correct: "A" })
    );
    const blueprint = buildQuestionSourceBlueprint(bank, [], 10);
    expect(blueprint.officialStyle.sampleSize).toBe(50);
  });
});

describe("generateMcqs", () => {
  const longText = "Insulin is an anabolic hormone from beta cells. ".repeat(6);
  const q = { stem: "A patient...?", choices: { A: "a", B: "b", C: "c", D: "d" }, correct: "C", explanation: "x" };

  it("builds the prompt from lecture text and normalizes model output", async () => {
    const callAIJSON = vi.fn().mockResolvedValue({ questions: [q, { ...q, correct: "Z" }] });
    const r = await generateMcqs({ lectureText: longText, subject: "Endocrine" }, { callAIJSON, skipQuestionAudit: true });
    expect(callAIJSON).toHaveBeenCalledOnce();
    expect(callAIJSON.mock.calls[0][1]).toContain("Insulin is an anabolic hormone");
    expect(r.questions).toHaveLength(1); // the "Z" correct dropped by normalize
  });
  it("errors without an AI call when lecture text is too short", async () => {
    const callAIJSON = vi.fn();
    const r = await generateMcqs({ lectureText: "short" }, { callAIJSON });
    expect(callAIJSON).not.toHaveBeenCalled();
    expect(r.error).toBeTruthy();
  });
});

describe("parseExemplarsFromMd", () => {
  const md = "1. A patient presents...?\nA) foo B) bar C) baz D) qux\nAnswer: B\n".repeat(4);

  it("prompt embeds the source text and asks for the questions JSON shape", () => {
    const p = buildExemplarParsePrompt("QUESTION ONE stem here");
    expect(p).toContain("QUESTION ONE stem here");
    expect(p).toMatch(/"questions"/);
    expect(p).toMatch(/choices/);
  });
  it("parses the AI output through normalizeQuestions", async () => {
    const callAIJSON = vi.fn().mockResolvedValue({
      questions: [
        { stem: "A patient with X?", choices: { A: "a", B: "b", C: "c", D: "d" }, correct: "B", explanation: "e" },
        { stem: "", choices: { A: "a", B: "b" }, correct: "A" }, // invalid, dropped
      ],
    });
    const r = await parseExemplarsFromMd(md, { callAIJSON });
    expect(callAIJSON).toHaveBeenCalledOnce();
    expect(r.questions).toHaveLength(1);
    expect(r.questions[0].choices[r.questions[0].correct]).toBe("b");
  });
  it("errors (no AI call) on too-short input", async () => {
    const callAIJSON = vi.fn();
    const r = await parseExemplarsFromMd("nope", { callAIJSON });
    expect(callAIJSON).not.toHaveBeenCalled();
    expect(r.error).toBeTruthy();
  });
});

describe("generateFromAtoms", () => {
  const atoms = [
    { type: "definition", term: "Herring bodies", content: "Axonal dilations storing hormone+neurophysin." },
    { type: "relationship", term: "Prolactin", content: "Dopamine inhibits its secretion." },
  ];

  it("prompt lists each atom as a fact to test, one question per fact", () => {
    const p = buildAtomQuestionsPrompt({ atoms, subject: "Endocrine" });
    expect(p).toContain("Herring bodies");
    expect(p).toContain("Dopamine inhibits");
    expect(p).toMatch(/one question per fact/i);
  });
  it("explicitly prohibits testing objective wording instead of medicine", () => {
    expect(buildAtomQuestionsPrompt({ atoms, objectives: [{ id: "o1", objective: "Explain a pathway" }] }))
      .toMatch(/Never ask what an objective says/i);
  });
  it("generates + normalizes questions from atoms", async () => {
    const callAIJSON = vi.fn().mockResolvedValue({
      questions: [{ stem: "A slide shows dilated axon terminals...?", choices: { A: "Herring bodies", B: "x", C: "y", D: "z" }, correct: "A", explanation: "e" }],
    });
    const r = await generateFromAtoms({ atoms }, { callAIJSON, skipQuestionAudit: true });
    expect(callAIJSON).toHaveBeenCalledOnce();
    expect(r.questions).toHaveLength(1);
  });
  it("backfills topic from the source atom's term when the model omits it, instead of surfacing the raw stem", async () => {
    const callAIJSON = vi.fn().mockResolvedValue({
      questions: [
        { stem: "A slide shows dilated axon terminals...?", choices: { A: "Herring bodies", B: "x", C: "y", D: "z" }, correct: "A" },
        { stem: "Dopamine's effect on this hormone...?", choices: { A: "a", B: "Prolactin", C: "c", D: "d" }, correct: "B", topic: "Model's own topic" },
      ],
    });
    const r = await generateFromAtoms({ atoms }, { callAIJSON, skipQuestionAudit: true });
    const byStem = Object.fromEntries(r.questions.map((q) => [q.stem, q]));
    expect(byStem["A slide shows dilated axon terminals...?"].topic).toBe("Herring bodies");
    // The model's own topic, when present, is not clobbered by the backfill.
    expect(byStem["Dopamine's effect on this hormone...?"].topic).toBe("Model's own topic");
  });
  it("errors without an AI call when there are no atoms", async () => {
    const callAIJSON = vi.fn();
    const r = await generateFromAtoms({ atoms: [] }, { callAIJSON });
    expect(callAIJSON).not.toHaveBeenCalled();
    expect(r.error).toBeTruthy();
  });
  it("stamps each question with its source atom's normalized key, positionally — regardless of what the model said its topic was", async () => {
    const callAIJSON = vi.fn().mockResolvedValue({
      questions: [
        { stem: "A slide shows dilated axon terminals...?", choices: { A: "Herring bodies", B: "x", C: "y", D: "z" }, correct: "A" },
        { stem: "Dopamine's effect on this hormone...?", choices: { A: "a", B: "Prolactin", C: "c", D: "d" }, correct: "B", topic: "totally different wording" },
      ],
    });
    const r = await generateFromAtoms({ atoms }, { callAIJSON, skipQuestionAudit: true });
    const byStem = Object.fromEntries(r.questions.map((q) => [q.stem, q]));
    expect(byStem["A slide shows dilated axon terminals...?"].atomKey).toBe("herring bodies");
    expect(byStem["Dopamine's effect on this hormone...?"].atomKey).toBe("prolactin");
  });
  it("caps the fact list so the response JSON can't overflow", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ type: "definition", term: "T" + i, content: "c" }));
    const p = buildAtomQuestionsPrompt({ atoms: many });
    expect(p).toContain("T9");       // 10th (index 9) present
    expect(p).not.toContain("T10");  // 11th capped out
  });
});

describe("independent generated-question audit", () => {
  const questions = [{
    stem: "A 19-year-old woman presents with polyuria, polydipsia, and an 8-kg unintentional weight loss over 2 months. Laboratory studies show a fasting glucose concentration of 280 mg/dL and a very low serum C-peptide concentration. Which hormone is most likely deficient?",
    choices: { A: "Insulin", B: "Cortisol", C: "Glucagon", D: "Aldosterone", E: "Epinephrine" },
    correct: "A",
    explanation: "Low C-peptide demonstrates reduced endogenous insulin secretion. The resulting hyperglycemia causes osmotic diuresis and explains the polyuria and polydipsia.",
    whyWrong: { A: "Low C-peptide confirms reduced endogenous insulin.", B: "Cortisol excess can raise glucose but does not cause low C-peptide.", C: "Glucagon excess does not explain low C-peptide with this presentation.", D: "Aldosterone affects sodium and potassium rather than C-peptide.", E: "Epinephrine does not cause this persistent syndrome." },
    objectiveIds: ["o1"],
    topic: "insulin deficiency",
  }];

  it("provides curriculum evidence and requires a separate explicit verdict", () => {
    const prompt = buildQuestionAuditPrompt(questions, {
      objectives: [{ id: "o1", objective: "Explain insulin deficiency" }],
      atoms: [{ term: "Insulin", content: "Deficiency causes hyperglycemia.", objectiveIds: ["o1"] }],
    });
    expect(prompt).toContain("Independently audit every generated question");
    expect(prompt).toContain("Explain insulin deficiency");
    expect(prompt).toContain("single best answer");
  });

  it("reviews against actual school examples and rejects disconnected recall shortcuts", () => {
    const prompt = buildQuestionAuditPrompt(questions, { examples: [{ sourceFile: "NB ExamSoft.pdf", stem: "School comparison case?", choices: { A: "A", B: "B", C: "C", D: "D" }, correct: "A" }] });
    expect(prompt).toContain("School comparison case?");
    expect(prompt).toContain("two unrelated recall tasks");
    expect(prompt).toContain("one label or giveaway");
    expect(prompt).toContain("school_style_mismatch");
  });

  it("keeps only explicitly approved items and stamps the completed audit", async () => {
    const reviewAIJSON = vi.fn().mockResolvedValue({ reviews: [{ index: 0, approved: true, issues: [] }] });
    const result = await auditGeneratedQuestions(questions, {}, { reviewAIJSON });
    expect(reviewAIJSON).toHaveBeenCalledOnce();
    expect(result.questions[0].qualityAudit.status).toBe("approved");
  });

  it("keeps structurally sound questions when review reports only batch-style notes", async () => {
    const reviewAIJSON = vi.fn().mockResolvedValue({
      reviews: [{ index: 0, approved: false, issues: ["repetitive_task_ending", "order_level_mismatch"] }],
    });
    const result = await auditGeneratedQuestions(questions, {}, { reviewAIJSON });
    expect(result.questions).toHaveLength(1);
    expect(result.questions[0].qualityAudit).toMatchObject({
      status: "approved-with-notes",
      notes: ["repetitive_task_ending", "order_level_mismatch"],
    });
  });

  it("keeps a structurally valid reviewer replacement for a partially rejected batch", async () => {
    const second = {
      ...questions[0],
      stem: "A 52-year-old patient has progressive polyuria, polydipsia, weight loss, and fasting hyperglycemia with a low C-peptide concentration. Which hormone deficiency best explains this presentation?",
      topic: "insulin deficiency",
    };
    const replacement = {
      ...questions[0],
      stem: "A 48-year-old patient develops polyuria, polydipsia, weight loss, fasting hyperglycemia, and a markedly reduced C-peptide concentration. Which hormone is most directly deficient in this patient?",
      objectiveIds: ["o1"],
      objectiveFacet: "identify deficient hormone from endogenous secretion marker",
      taskType: "clinical-application",
      orderLevel: "second-order",
    };
    const reviewAIJSON = vi.fn().mockResolvedValue({ reviews: [
      { index: 0, approved: true, issues: [], replacement: null },
      { index: 1, approved: false, issues: ["weak_explanation"], replacement },
    ] });
    const result = await auditGeneratedQuestions(
      [questions[0], second],
      { objectives: [{ id: "o1", objective: "Explain insulin deficiency" }] },
      { reviewAIJSON }
    );
    expect(result.questions).toHaveLength(2);
    expect(result.questions.some((question) => question.qualityAudit?.status === "reviewer-repaired")).toBe(true);
  });

  it("rejects explicit medical failures but preserves sound clinical items when reviewer JSON is malformed", async () => {
    const rejected = await auditGeneratedQuestions(questions, {}, { reviewAIJSON: vi.fn().mockResolvedValue({ reviews: [{ index: 0, approved: false, issues: ["incorrect_key"] }] }) });
    const malformed = await auditGeneratedQuestions([{ ...questions[0], stem: "A patient has polyuria. Which hormone is deficient?" }], {}, { reviewAIJSON: vi.fn().mockResolvedValue({ questions: [] }) });
    expect(rejected.questions).toHaveLength(1);
    expect(rejected.questions[0].qualityAudit.status).toBe("local-validated");
    expect(rejected.warning).toMatch(/reviewer rejected/i);
    expect(malformed.questions).toHaveLength(0); // too short to qualify as a clinical fallback
  });

  it("keeps a structurally sound vignette when the independent reviewer transport fails", async () => {
    const clinical = {
      ...questions[0],
      stem: "A 46-year-old patient presents with polyuria, polydipsia, weight loss, and a fasting glucose concentration of 260 mg/dL. Laboratory testing shows very low C-peptide. Which hormone is deficient?",
    };
    expect(locallyValidClinicalQuestions([clinical])).toHaveLength(1);
    const result = await auditGeneratedQuestions([clinical], {}, { reviewAIJSON: vi.fn().mockRejectedValue(new Error("bridge JSON parse failed")) });
    expect(result.questions).toHaveLength(1);
    expect(result.questions[0].qualityAudit.status).toBe("local-validated");
    expect(result.warning).toMatch(/structural checks/i);
  });

  it("repairs a rejected batch before falling back", async () => {
    const repair = vi.fn().mockResolvedValue({ questions });
    const audit = vi.fn()
      .mockResolvedValueOnce({ reviews: [{ index: 0, approved: false, issues: ["weak_explanation"] }] })
      .mockResolvedValueOnce({ reviews: [{ index: 0, approved: true, issues: [] }] });
    const result = await auditGeneratedQuestions(questions, { objectives: [{ id: "o1", objective: "Explain insulin deficiency" }] }, { reviewAIJSON: audit, repairAIJSON: repair });
    expect(repair).toHaveBeenCalledOnce();
    expect(audit).toHaveBeenCalledTimes(2);
    expect(result.questions[0].qualityAudit.status).toBe("approved");
  });

  it("does not preserve a generated question whose answer is present in its stem", () => {
    const leaked = {
      ...questions[0],
      stem: "A 46-year-old patient presents with polyuria and polydipsia. Testing confirms insulin deficiency after autoimmune beta-cell destruction. Which hormone is deficient?",
      choices: { A: "Insulin", B: "Cortisol", C: "Glucagon", D: "Aldosterone", E: "Epinephrine" },
    };
    expect(locallyValidClinicalQuestions([leaked])).toEqual([]);
  });

  it("rejects a vague clinical wrapper whose clues do not distinguish the answer", () => {
    const vague = {
      stem: "A 45-year-old man presents with a history of intermittent abdominal pain. On examination, the patient has tenderness in the upper mid-abdomen. Which of the following best describes the location of the peritoneum in this patient?",
      choices: { A: "Parietal peritoneum", B: "Visceral peritoneum", C: "Peritoneal cavity", D: "Mesentery", E: "Lesser sac" },
      correct: "B",
      explanation: "The visceral peritoneum covers abdominal organs and therefore is the best answer for this patient's nonspecific tenderness.",
      whyWrong: { A: "It lines the wall, not the reason for the symptoms.", B: "It covers organs.", C: "It is a space, not the reason for the symptoms.", D: "It suspends bowel.", E: "It is posterior to the stomach." },
    };
    expect(locallyValidClinicalQuestions([vague])).toEqual([]);
  });

  it("runs after generation as a second AI request", async () => {
    const callAIJSON = vi.fn().mockResolvedValue({ questions });
    const reviewAIJSON = vi.fn().mockResolvedValue({ reviews: [{ index: 0, approved: true, issues: [] }] });
    const result = await generateMcqs({ lectureText: "Insulin lowers serum glucose. ".repeat(8) }, { callAIJSON, reviewAIJSON });
    expect(callAIJSON).toHaveBeenCalledOnce();
    expect(reviewAIJSON).toHaveBeenCalledOnce();
    expect(result.questions).toHaveLength(1);
  });
});

describe("per-choice explanations (whyWrong)", () => {
  const base = {
    stem: "A 45-year-old man presents with polyuria. Which hormone is deficient?",
    choices: { A: "Insulin", B: "Glucagon", C: "Cortisol", D: "TSH" },
    correct: "A",
    explanation: "Type 1 DM = insulin deficiency.",
    whyWrong: { A: "Beta-cell loss.", B: "Raises glucose, does not lower it.", C: "Would cause hyperglycemia with cushingoid signs.", D: "Thyroid axis, not glycemic." },
  };

  it("keeps a letter-keyed explanation for every choice", () => {
    const [q] = normalizeQuestions([base]);
    expect(Object.keys(q.whyWrong).sort()).toEqual(["A", "B", "C", "D"]);
  });

  it("drops entries for letters the question never offered", () => {
    const [q] = normalizeQuestions([{ ...base, whyWrong: { ...base.whyWrong, E: "no such option" } }]);
    expect(q.whyWrong.E).toBeUndefined();
  });

  it("tolerates a missing or malformed whyWrong", () => {
    expect(normalizeQuestions([{ ...base, whyWrong: undefined }])[0].whyWrong).toEqual({});
    expect(normalizeQuestions([{ ...base, whyWrong: "prose instead" }])[0].whyWrong).toEqual({});
    expect(normalizeQuestions([{ ...base, whyWrong: { A: "   " } }])[0].whyWrong).toEqual({});
  });

  it("moves each explanation with its option when the choices are shuffled", () => {
    // Reverse the choices deterministically so every letter actually changes slot.
    const seq = [0, 0, 0, 0];
    let i = 0;
    vi.spyOn(Math, "random").mockImplementation(() => seq[i++ % seq.length]);
    const [q] = normalizeQuestions([base]);
    Math.random.mockRestore();

    for (const [letter, text] of Object.entries(q.choices)) {
      const origLetter = Object.keys(base.choices).find((l) => base.choices[l] === text);
      expect(q.whyWrong[letter]).toBe(base.whyWrong[origLetter]);
    }
    expect(q.choices[q.correct]).toBe("Insulin");
  });

  it("both generation prompts demand the letter-keyed object", () => {
    for (const p of [
      buildMcqPrompt({ subject: "Endocrine", lectureText: "Insulin is anabolic." }),
      buildAtomQuestionsPrompt({ atoms: [{ type: "definition", term: "Insulin", content: "Anabolic." }] }),
    ]) {
      expect(p).toContain("whyWrong");
      expect(p).toMatch(/INCLUDING the correct one/);
    }
  });
});

describe("five options", () => {
  it("both generation prompts ask for exactly 5 options A-E", () => {
    for (const p of [
      buildMcqPrompt({ subject: "Endocrine", lectureText: "Insulin is anabolic." }),
      buildAtomQuestionsPrompt({ atoms: [{ type: "definition", term: "Insulin", content: "Anabolic." }] }),
    ]) {
      expect(p).toMatch(/5 options A-E/);
      expect(p).toContain('"E":"..."');
      expect(p).not.toMatch(/4 options A-D/);
    }
  });

  it("tells the model to match the exemplar's option count instead of always forcing 5", () => {
    for (const p of [
      buildMcqPrompt({ subject: "Endocrine", lectureText: "Insulin is anabolic." }),
      buildAtomQuestionsPrompt({ atoms: [{ type: "definition", term: "Insulin", content: "Anabolic." }] }),
    ]) {
      expect(p).toMatch(/match the option count/i);
      expect(p).toMatch(/otherwise.*5 options A-E/i);
    }
  });

  it("keeps a five-option question intact through normalize", () => {
    const [q] = normalizeQuestions([{
      stem: "A 34-year-old woman has bitemporal hemianopsia. Which hormone do the eosinophilic cells make?",
      choices: { A: "ACTH", B: "FSH", C: "Growth hormone", D: "TSH", E: "LH" },
      correct: "C",
      explanation: "Acidophils are somatotrophs.",
    }]);
    expect(Object.keys(q.choices).sort()).toEqual(["A", "B", "C", "D", "E"]);
    expect(q.choices[q.correct]).toBe("Growth hormone");
  });

  it("keeps a six-option question intact through normalize (real exams sometimes run A-F)", () => {
    const [q] = normalizeQuestions([{
      stem: "A 34-year-old woman has bitemporal hemianopsia. Which hormone do the eosinophilic cells make?",
      choices: { A: "ACTH", B: "FSH", C: "Growth hormone", D: "TSH", E: "LH", F: "Prolactin" },
      correct: "C",
      explanation: "Acidophils are somatotrophs.",
    }]);
    expect(Object.keys(q.choices).sort()).toEqual(["A", "B", "C", "D", "E", "F"]);
    expect(q.choices[q.correct]).toBe("Growth hormone");
  });

  it("renders a table-shaped exemplar choice as column: value text, not [object Object]", () => {
    const p = buildAtomQuestionsPrompt({
      atoms: [{ type: "definition", term: "Insulin", content: "Anabolic." }],
      examples: [
        {
          stem: "Which pattern matches primary hyperparathyroidism?",
          choices: {
            A: { PTH: "increased", Calcium: "increased", Phosphate: "decreased" },
            B: { PTH: "decreased", Calcium: "decreased", Phosphate: "increased" },
          },
          correct: "A",
        },
      ],
    });
    expect(p).toContain("PTH: increased");
    expect(p).toContain("Calcium: increased");
    expect(p).not.toMatch(/\[object Object\]/);
  });

  it("keeps a table-shaped question's choiceLayout, choiceColumns and hasImage through normalize", () => {
    const [q] = normalizeQuestions([{
      stem: "Given the biopsy image and lab table, which pattern fits?",
      choices: {
        A: { PTH: "increased", Calcium: "increased" },
        B: { PTH: "decreased", Calcium: "decreased" },
      },
      correct: "A",
      choiceLayout: "table",
      choiceColumns: ["PTH", "Calcium"],
      hasImage: true,
    }]);
    expect(q.choiceLayout).toBe("table");
    expect(q.choiceColumns).toEqual(["PTH", "Calcium"]);
    expect(q.hasImage).toBe(true);
    expect(q.choices[q.correct]).toEqual({ PTH: "increased", Calcium: "increased" });
  });

  it("renders each exemplar with the options it actually has", () => {
    const p = buildAtomQuestionsPrompt({
      atoms: [{ type: "definition", term: "Insulin", content: "Anabolic." }],
      examples: [
        { stem: "Five-option item?", choices: { A: "a", B: "b", C: "c", D: "d", E: "e" }, correct: "E" },
        { stem: "Three-option item?", choices: { A: "a", B: "b", C: "c" }, correct: "A" },
      ],
    });
    expect(p).toContain("E: e");
    // The three-option exemplar must not sprout empty D/E slots.
    expect(p).not.toMatch(/D: undefined/);
  });
});

describe("separate reasoning review gate", () => {
  const question = { stem: "A patient develops increasing ventricular pressure after a narrowing interrupts the passage between the third and fourth ventricles. Production of fluid continues. What upstream change is expected?",
    choices: { A: "Expansion of upstream ventricles", B: "Collapse of upstream ventricles", C: "Isolated fourth ventricle enlargement", D: "No ventricular change" }, correct: "A",
    explanation: "An obstruction interrupts the passage of CSF, and continued production expands the upstream ventricular spaces.", objectiveIds: ["o1"], orderLevel: "third-order" };
  const cfg = { requireReasoningAudit: true, objectives: [{ id: "o1", objective: "Analyze CSF obstruction", bloom_level: 3 }],
    atoms: [{ term: "Obstruction", content: "Aqueduct obstruction prevents CSF passage into the fourth ventricle." }, { term: "Expansion", content: "Continued CSF production expands the spaces upstream of an obstruction." }] };
  it("reviews each compact item and rejects quotes copied from generated explanations", async () => {
    const reasoning = { orderLevel: "third-order", steps: ["Localize obstruction", "Trace upstream flow", "Predict expansion"],
      sourceQuotes: cfg.atoms.map(a => a.content), allStepsRequired: true, connectedChain: true, singleEndpoint: true, choiceShortcut: false };
    const reviewer = vi.fn()
      .mockResolvedValueOnce({ reviews: [{ index: 0, approved: true, objectiveAligned: true, issues: [], reasoning }] })
      .mockResolvedValueOnce({ reviews: [{ index: 0, approved: true, objectiveAligned: true, issues: [], reasoning: { ...reasoning, sourceQuotes: [question.explanation] } }] });
    const result = await auditGeneratedQuestions([question, { ...question, stem: "A patient develops pressure upstream of an obstruction. What fluid compartment expands?" }],
      { ...cfg, promptProfile: "compact" }, { reviewAIJSON: reviewer, skipRepair: true });
    expect(reviewer).toHaveBeenCalledTimes(2);
    expect(reviewer.mock.calls.every(call => call[1].includes("REQUIRED REVIEW COUNT: 1"))).toBe(true);
    expect(reviewer.mock.calls[1][1]).toContain("OTHER BATCH STEMS");
    expect(result.questions).toHaveLength(1);
    expect(result.questions[0].reasoningAudit.status).toBe("verified");
  });
  it("retains verified reviews when a later reviewer request times out", async () => {
    const reasoning = { orderLevel: "third-order", steps: ["Localize obstruction", "Trace upstream flow", "Predict expansion"],
      sourceQuotes: cfg.atoms.map(a => a.content), allStepsRequired: true, connectedChain: true, singleEndpoint: true, choiceShortcut: false };
    const reviewer = vi.fn()
      .mockResolvedValueOnce({ reviews: [{ index: 0, approved: true, objectiveAligned: true, issues: [], reasoning }] })
      .mockRejectedValueOnce(new Error("Local review timed out"));
    const result = await auditGeneratedQuestions([question, { ...question, stem: "A patient has an upstream obstruction. What space expands as secretion continues?" }],
      { ...cfg, promptProfile: "compact" }, { reviewAIJSON: reviewer });
    expect(reviewer).toHaveBeenCalledTimes(2);
    expect(result.questions).toHaveLength(1);
    expect(result.warning).toMatch(/timed out/);
  });
  it("stops repair loops when claimed approvals cannot be grounded in the source", async () => {
    const reviewer = vi.fn().mockResolvedValue({ reviews: [{ index: 0, approved: true, reasoning: {
      orderLevel: "third-order", steps: ["Localize obstruction", "Trace upstream flow", "Predict expansion"],
      sourceQuotes: [question.explanation], allStepsRequired: true, connectedChain: true, singleEndpoint: true, choiceShortcut: false,
    } }] });
    const repair = vi.fn();
    const result = await auditGeneratedQuestions([question], { ...cfg, promptProfile: "compact" }, { reviewAIJSON: reviewer, repairAIJSON: repair });
    expect(result.questions).toEqual([]);
    expect(result.error).toMatch(/stronger reviewer/);
    expect(repair).not.toHaveBeenCalled();
  });
  it("stops a compact reviewer after repeated ungrounded approvals instead of reviewing and repairing the whole batch", async () => {
    const reviewer = vi.fn().mockResolvedValue({ reviews: [{ index: 0, approved: true, reasoning: {
      orderLevel: "third-order", steps: ["Locate obstruction", "Trace flow", "Predict expansion"], sourceQuotes: [question.explanation],
      allStepsRequired: true, connectedChain: true, singleEndpoint: true, choiceShortcut: false,
    } }] });
    const repair = vi.fn();
    const result = await auditGeneratedQuestions([question, question, question, question, question],
      { ...cfg, promptProfile: "compact" }, { reviewAIJSON: reviewer, repairAIJSON: repair });
    expect(reviewer).toHaveBeenCalledTimes(2);
    expect(result.questions).toEqual([]);
    expect(result.error).toMatch(/stronger reviewer/);
    expect(repair).not.toHaveBeenCalled();
  });
  it("does not credit verified recall when the objective requests application", async () => {
    const result = await auditGeneratedQuestions([question], { ...cfg, promptProfile: "compact", objectives: [{ ...cfg.objectives[0], _targetOrder: "second-order" }] }, {
      skipRepair: true,
      reviewAIJSON: async () => ({ reviews: [{ index: 0, approved: true, objectiveAligned: true, issues: [], reasoning: {
        orderLevel: "first-order", steps: ["Recall obstruction"], sourceQuotes: [cfg.atoms[0].content], allStepsRequired: true, connectedChain: true, singleEndpoint: true, choiceShortcut: false,
      } }] }),
    });
    expect(result.questions).toEqual([]);
    expect(result.rejections[0].issues).toEqual(["insufficient_reasoning_depth"]);
    expect(result.error).toContain("insufficient_reasoning_depth");
  });
  it("withholds self-labeled advanced questions if the separate review has no chain", async () => {
    const result = await auditGeneratedQuestions([question], cfg, { reviewAIJSON: async () => ({ reviews: [{ index: 0, approved: true, issues: [] }] }), skipRepair: true });
    expect(result.questions).toEqual([]);
  });
  it("batches a capable reviewer while withholding missing item verdicts", async () => {
    const review = { index: 0, approved: true, issues: [], reasoning: {
      orderLevel: "third-order", steps: ["Localize obstruction", "Trace the fluid path", "Predict upstream expansion"], sourceQuotes: cfg.atoms.map(a => a.content), allStepsRequired: true, connectedChain: true, singleEndpoint: true, choiceShortcut: false,
    } };
    const reviewer = vi.fn().mockResolvedValue({ reviews: [review] });
    const result = await auditGeneratedQuestions([question, { ...question, stem: "A patient's aqueduct is narrowed. CSF secretion continues; predict the upstream ventricular response." }], { ...cfg, promptProfile: "compact" }, { reviewAIJSON: reviewer, reviewBatchSize: 3, skipRepair: true });
    expect(reviewer).toHaveBeenCalledTimes(1);
    expect(reviewer.mock.calls[0][3]).toBe(3200);
    expect(result.questions).toHaveLength(1);
    expect(result.warning).toContain("no review returned");
  });

  it("rechecks a partially grounded quotation once without accepting paraphrased evidence", async () => {
    const reasoning = { orderLevel: "third-order", steps: ["Localize obstruction", "Trace fluid passage", "Predict upstream expansion"], sourceQuotes: cfg.atoms.map(a => a.content), allStepsRequired: true, connectedChain: true, singleEndpoint: true, choiceShortcut: false };
    const reviewer = vi.fn()
      .mockResolvedValueOnce({ reviews: [{ index: 0, approved: true, issues: [], reasoning: { ...reasoning, sourceQuotes: [cfg.atoms[0].content, "Continued production makes the ventricles bigger"] } }] })
      .mockResolvedValueOnce({ reviews: [{ index: 0, approved: true, issues: [], reasoning }] });
    const result = await auditGeneratedQuestions([question], { ...cfg, promptProfile: "compact" }, { reviewAIJSON: reviewer, skipRepair: true });
    expect(reviewer).toHaveBeenCalledTimes(2);
    expect(result.questions[0]?.reasoningAudit.sourceQuotes).toEqual(cfg.atoms.map(a => a.content));
  });

  it("attaches the separately verified chain and actual order to accepted questions", async () => {
    const result = await auditGeneratedQuestions([question], cfg, { reviewAIJSON: async () => ({ reviews: [{ index: 0, approved: true, issues: [], reasoning: {
      orderLevel: "third-order", steps: ["Localize aqueduct obstruction", "Trace the upstream CSF route", "Predict expansion with continuing secretion"],
      sourceQuotes: cfg.atoms.map(atom => atom.content), allStepsRequired: true, connectedChain: true, singleEndpoint: true, choiceShortcut: false,
    } }] }), skipRepair: true });
    expect(result.questions[0]?.reasoningAudit).toMatchObject({ status: "verified", orderLevel: "third-order" });
  });
});

it("accepts a source-reviewed semantic objective link without requiring the objective's literal words", async () => {
  const cfg = { requireReasoningAudit: true, objectives: [{ id: "o1", objective: "Correlate composition of CSF with disease processes", bloom_level: 3 }],
    lectureText: "Accumulations of cells in subarachnoid fluid impede passage through arachnoid villi. Impaired absorption enlarges ventricles." };
  const question = { stem: "A patient has increased cells in lumbar fluid. Ventricles are enlarged and their passages remain patent. Which structure has impaired drainage?",
    choices: { A: "Arachnoid villi", B: "Aqueduct", C: "Choroid plexus", D: "Central canal" }, correct: "A",
    explanation: "Cellular accumulation impedes arachnoid-villus passage, reducing drainage despite patent ventricular passages.", objectiveIds: ["o1"] };
  expect(questionMatchesObjectiveDomain(question, cfg)).toBe(false);
  const review = { index: 0, approved: true, objectiveAligned: true, issues: [], reasoning: { orderLevel: "second-order",
    steps: ["Interpret the cellular accumulation", "Connect cells to impaired drainage at the villi"], sourceQuotes: ["Accumulations of cells in subarachnoid fluid impede passage through arachnoid villi."],
    allStepsRequired: true, connectedChain: true, singleEndpoint: true, choiceShortcut: false } };
  const result = await auditGeneratedQuestions([question], cfg, { reviewAIJSON: async () => ({ reviews: [review] }), skipRepair: true });
  expect(result.questions).toHaveLength(1);
  expect(questionMatchesObjectiveDomain(result.questions[0], cfg)).toBe(true);
  const withheld = await auditGeneratedQuestions([question], cfg, { reviewAIJSON: async () => ({ reviews: [{ ...review, objectiveAligned: false }] }), skipRepair: true });
  expect(withheld.questions).toEqual([]);
});

it("sends the objective facet and task to the separate reviewer", () => {
  const prompt = buildQuestionAuditPrompt([{ stem: "Case?", choices: { A: "One", B: "Two" }, correct: "A", objectiveIds: ["o1"],
    objectiveFacet: "Infer impaired CSF absorption from cellular content", taskType: "clinical-application" }], { objectives: [{ id: "o1", objective: "Correlate CSF composition with disease" }] });
  expect(prompt).toContain('"objectiveFacet":"Infer impaired CSF absorption from cellular content"');
  expect(prompt).toContain('"taskType":"clinical-application"');
});

it("preserves a drafting plan for independent review without treating it as approval", async () => {
  const plan = { relationship: "Release follows calcium entry", perturbation: "Calcium entry blocked", inference: "Less release", endpoint: "Postsynaptic response", nearestDistractor: "Increased release", discriminator: "Calcium entry absent", sourceQuotes: ["Release follows calcium entry"] };
  const [question] = normalizeQuestions([{ stem: "An experiment blocks calcium entry. What happens next?", choices: { A: "Release decreases", B: "Release increases" }, correct: "A", questionPlan: plan }]);
  expect(question.questionPlan).toEqual(plan);
  const prompt = buildQuestionAuditPrompt([question], { promptProfile: "compact" });
  expect(prompt).toContain('"questionPlan":');
  expect(prompt).toContain("untrusted hypothesis");
  const result = await auditGeneratedQuestions([question], { requireReasoningAudit: true, promptProfile: "compact" }, { skipRepair: true, reviewAIJSON: async () => ({ reviews: [] }) });
  expect(result.questions).toEqual([]);
});

 describe("explanation-only repair boundaries", () => {
   const question = { stem: "unchanged", correct: "A", choices: { A: "one", B: "two" }, objectiveIds: ["o1"], explanation: "old", whyWrong: {} };
   const review = { approved: false, issues: ["weak_explanation"], replacement: { ...question, explanation: "source-supported correction", whyWrong: { A: "right", B: "wrong" } } };
   it("preserves every tested field while updating prose", () => {
     expect(explanationOnlyReplacement(question, review)).toEqual({ ...question, explanation: review.replacement.explanation, whyWrong: review.replacement.whyWrong });
   });
   it("rejects changed keys and non-prose defects", () => {
     expect(explanationOnlyReplacement(question, { ...review, replacement: { ...review.replacement, correct: "B" } })).toBeNull();
     expect(explanationOnlyReplacement(question, { ...review, issues: ["weak_explanation", "unsupported_fact"] })).toBeNull();
   });
 });

it("reports actual reviewer defects when strict preparation skips whole-batch repair", async () => {
  const question = { stem: "A patient develops edema after ischemia. Which mechanism explains the intracellular swelling?", choices: { A: "Pump failure", B: "Protein leakage" }, correct: "A", objectiveIds: ["o1"], explanation: "ATP depletion impairs pumps." };
  const result = await auditGeneratedQuestions([question], { requireReasoningAudit: true }, {
    skipRepair: true, reviewAIJSON: async () => ({ reviews: [{ index: 0, approved: false, issues: ["unsupported_fact"], rationale: "The source does not support the discriminator." }] }),
  });
  expect(result.questions).toEqual([]);
  expect(result.error).toContain("unsupported_fact");
  expect(result.rejections[0].rationale).toContain("discriminator");
});
