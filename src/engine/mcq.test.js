import { describe, it, expect } from "vitest";
import { vi } from "vitest";
import { normalizeQuestions, buildMcqPrompt, generateMcqs, buildExemplarParsePrompt, parseExemplarsFromMd, buildAtomQuestionsPrompt, generateFromAtoms } from "./mcq.js";

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
  it("errors without an AI call when there are no atoms", async () => {
    const callAIJSON = vi.fn();
    const r = await generateFromAtoms({ atoms: [] }, { callAIJSON });
    expect(callAIJSON).not.toHaveBeenCalled();
    expect(r.error).toBeTruthy();
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
