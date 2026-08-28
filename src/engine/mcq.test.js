import { describe, it, expect } from "vitest";
import { vi } from "vitest";
import { normalizeQuestions, buildMcqPrompt, generateMcqs, buildExemplarParsePrompt, parseExemplarsFromMd, buildAtomQuestionsPrompt, generateFromAtoms, selectStyleExemplars } from "./mcq.js";

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
});

describe("buildMcqPrompt", () => {
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
  it("includes lecture content, objectives, difficulty and count", () => {
    expect(prompt).toContain("Insulin is an anabolic hormone");
    expect(prompt).toContain("Describe insulin secretion");
    expect(prompt).toMatch(/HARD/);
    expect(prompt).toContain("5");
  });
  it("asks for strict JSON with the questions shape", () => {
    expect(prompt).toMatch(/"questions"/);
    expect(prompt).toMatch(/stem/);
    expect(prompt).toMatch(/choices/);
  });
});

describe("selectStyleExemplars", () => {
  const q = (stem, count, extra = {}) => ({
    stem,
    choices: Object.fromEntries("ABCDEFGH".slice(0, count).split("").map((letter) => [letter, letter])),
    ...extra,
  });

  it("prioritizes IMCQ challenge references for hard/expert but school quizzes for medium", () => {
    const school = q("School quiz", 5, { correct: "A" });
    const imcq = q("IMCQ", 5, { sourceKind: "imcq", answerKeyVerified: true, correct: "A" });
    const unverified = q("Unverified", 5, { sourceKind: "imcq", answerKeyVerified: false });
    expect(selectStyleExemplars([school, imcq, unverified], 1, "expert")).toEqual([imcq]);
    expect(selectStyleExemplars([imcq, school], 1, "medium")).toEqual([school]);
    expect(selectStyleExemplars([school], 0)).toEqual([]);
    expect(buildAtomQuestionsPrompt({ examples: [imcq], difficulty: "expert" })).toContain("IMCQ challenge reference");
    expect(buildMcqPrompt({ examples: [imcq], difficulty: "expert" })).toContain("not calibrated");
  });

  it("represents the school's different option counts and excludes unusable image-only examples", () => {
    const selected = selectStyleExemplars([
      q("four-1", 4), q("four-2", 4), q("five", 5), q("six", 6), q("seven", 7),
      q("image", 8, { hasImage: true }), q("eight", 8),
    ]);
    expect(selected.map((item) => Object.keys(item.choices).length)).toEqual([4, 5, 6, 7, 8]);
    expect(selected.map((item) => item.stem)).not.toContain("image");
  });
});

describe("generateMcqs", () => {
  const longText = "Insulin is an anabolic hormone from beta cells. ".repeat(6);
  const q = { stem: "A patient...?", choices: { A: "a", B: "b", C: "c", D: "d" }, correct: "C", explanation: "x" };

  it("builds the prompt from lecture text and normalizes model output", async () => {
    const callAIJSON = vi.fn().mockResolvedValue({ questions: [q, { ...q, correct: "Z" }] });
    const r = await generateMcqs({ lectureText: longText, subject: "Endocrine" }, { callAIJSON });
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
  it("generates + normalizes questions from atoms", async () => {
    const callAIJSON = vi.fn().mockResolvedValue({
      questions: [{ stem: "A slide shows dilated axon terminals...?", choices: { A: "Herring bodies", B: "x", C: "y", D: "z" }, correct: "A", explanation: "e" }],
    });
    const r = await generateFromAtoms({ atoms }, { callAIJSON });
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
    const r = await generateFromAtoms({ atoms }, { callAIJSON });
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
    const r = await generateFromAtoms({ atoms }, { callAIJSON });
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
