import { describe, expect, it } from "vitest";
import { extractPairedAnswerKey, pairQuestionBankFiles, selectQuestionBankFiles, summarizeBankUpload, tagBankQuestions } from "./questionBankIngest.js";

const opts = { blockId: "b1", filename: "2024-final.pdf", idgen: (() => { let n = 0; return () => `q${++n}`; })(), now: () => "2026-07-29T00:00:00.000Z" };

describe("selectQuestionBankFiles", () => {
  it("prefers an original PDF when a folder contains its Markdown extraction", () => {
    const pdf = { name: "DM+Week+4+Biochemistry+Practice+Questions.pdf" };
    const markdown = { name: "DM+Week+4+Biochemistry+Practice+Questions.md" };
    expect(selectQuestionBankFiles([markdown, pdf])).toEqual([pdf]);
  });

  it("filters directory selections to supported question-bank files, including clicker images", () => {
    expect(selectQuestionBankFiles([{ name: "notes.docx" }, { name: "questions.txt" }, { name: "figures.jpeg" }]).map((file) => file.name))
      .toEqual(["figures.jpeg", "questions.txt"]);
  });

  it("keeps same-named clicker images from separate selected folders", () => {
    const first = { name: "slide.jpeg", webkitRelativePath: "Week 3/slide.jpeg" };
    const second = { name: "slide.jpeg", webkitRelativePath: "Week 4/slide.jpeg" };
    expect(selectQuestionBankFiles([first, second])).toEqual([first, second]);
  });
});

describe("paired question and answer files", () => {
  it("pairs a Clinical Correlates question PDF with its standalone key", () => {
    const questionFile = { name: "DM Clinical Correlates.pdf" };
    const answerFile = { name: "DM Clinical Correlates Key.pdf" };
    expect(pairQuestionBankFiles([answerFile, questionFile])).toEqual([{ questionFile, answerFile }]);
  });

  it("pairs ExamSoft practice and explanation filenames with different naming conventions", () => {
    const questionFile = { name: "ExamsoftPractice_QuestionsDM1.pdf" };
    const answerFile = { name: "DM ESOFT Quiz 1 Answer Explanations.pdf" };
    expect(pairQuestionBankFiles([answerFile, questionFile])).toEqual([{ questionFile, answerFile }]);
  });

  it("extracts keyed answers and rationales across PDF page breaks", () => {
    const key = extractPairedAnswerKey("Q1 Answer: C. First rationale.\n\fQ2 Answer: A. Second rationale.");
    expect(key.get(1)).toEqual({ correct: "C", explanation: "First rationale." });
    expect(key.get(2)).toEqual({ correct: "A", explanation: "Second rationale." });
  });

  it("extracts ExamSoft answer explanations", () => {
    const key = extractPairedAnswerKey("Q1 — Topic (Answer: D)\n  • D ✓ — The keyed rationale.\n\nQ2 — Next (Answer: B)\n  • B ✓ — Another rationale.");
    expect(key.get(1)).toEqual({ correct: "D", explanation: "• D ✓ — The keyed rationale." });
    expect(key.get(2)).toEqual({ correct: "B", explanation: "• B ✓ — Another rationale." });
  });
});

describe("tagBankQuestions", () => {
  it("stamps provenance on every question", () => {
    const [q] = tagBankQuestions([{ stem: "Which nerve?", choices: { A: "a" } }], opts);
    expect(q).toMatchObject({
      stem: "Which nerve?",
      id: "q1",
      blockId: "b1",
      sourceFile: "2024-final.pdf",
      importedAt: "2026-07-29T00:00:00.000Z",
      bankType: "neutral",
      sourceKind: "school",
    });
  });

  it("marks student-created material as supplemental", () => {
    const [q] = tagBankQuestions([{ stem: "Study prompt?" }], { ...opts, sourceKind: "supplemental" });
    expect(q.sourceKind).toBe("supplemental");
  });

  it("marks a wrong-answers upload, which generation weights differently", () => {
    const [q] = tagBankQuestions([{ stem: "Q?" }], { ...opts, wrongOnly: true });
    expect(q.bankType).toBe("wrong");
  });

  it("keeps an id the parser already assigned", () => {
    const [q] = tagBankQuestions([{ id: "keep-me", stem: "Q?" }], opts);
    expect(q.id).toBe("keep-me");
  });

  it("drops entries with no question text — the parser emits them from stray pages", () => {
    expect(tagBankQuestions([{ stem: "Q?" }, {}, null, { choices: {} }], opts)).toHaveLength(1);
  });

  it("survives a parser that returned nothing", () => {
    expect(tagBankQuestions(undefined, opts)).toEqual([]);
  });
});

describe("summarizeBankUpload", () => {
  it("separates saved, empty and failed files", () => {
    const s = summarizeBankUpload([
      { filename: "a.pdf", questions: [{}, {}] },
      { filename: "b.pdf", questions: [] },
      { filename: "c.pdf", error: "not a PDF" },
    ]);
    expect(s).toEqual({
      files: 3,
      saved: 1,
      empty: ["b.pdf"],
      failed: ["c.pdf: not a PDF"],
      questions: 2,
      reports: 0,
    });
  });

  it("counts a score report without mislabeling it as an empty question bank", () => {
    expect(summarizeBankUpload([{ filename: "report.txt", questions: [], report: true }])).toMatchObject({
      saved: 0, reports: 1, questions: 0, empty: [],
    });
  });

  it("reports nothing for an empty batch", () => {
    expect(summarizeBankUpload([])).toMatchObject({ files: 0, saved: 0, questions: 0 });
  });
});

import { imcqNumber, pairImcqExplanationFiles, mergeImcqKeyWithExplanations } from "./questionBankIngest.js";
describe("IMCQ key decks paired with answer-explanation handouts", () => {
  const f = (name) => ({ name });
  it("reads the IMCQ number from key decks, practice decks and explanation handouts", () => {
    expect(imcqNumber("NB+IMCQ+KEY_01.pdf")).toBe(1);
    expect(imcqNumber("NB IMCQ 11 Practice Questions.pdf")).toBe(11);
    expect(imcqNumber("NB IMCQ 9 Behavioral Sciences Answer Explanations.pdf")).toBe(9);
    expect(imcqNumber("Week 15 NB NSCI Practice Questions.pdf")).toBe(null);
  });
  it("pairs each deck with the explanation handout of the same number and leaves the rest alone", () => {
    const files = [f("NB+IMCQ+KEY_01.pdf"), f("NB IMCQ 1 Answer Explanations.pdf"), f("NB IMCQ 2 Answer Explanations.pdf"), f("NB IMCQ 11 Practice Questions.pdf")];
    const pairs = pairImcqExplanationFiles(files);
    expect(pairs.map((p) => [p.deckFile.name, p.explanationFile.name])).toEqual([["NB+IMCQ+KEY_01.pdf", "NB IMCQ 1 Answer Explanations.pdf"]]);
  });
  it("keeps the original vignette, takes the written key and per-choice notes, and fills a missing slide from the handout", () => {
    const deck = [
      { num: 2, stem: "Full vignette two", choices: { A: "Alpha", B: "Beta" }, correct: null, hasImage: true },
      { num: 3, stem: "Full vignette three", choices: { A: "Gamma", B: "Delta" }, correct: "A" },
    ];
    const records = new Map([
      [1, { correct: "B", choices: { A: "One", B: "Two" }, explanations: { A: "No.", B: "Yes." }, summary: "short one", question: { num: 1, stem: "short one. Which option best answers this review prompt?", choices: { A: "One", B: "Two" }, correct: "B" } }],
      [2, { correct: "B", choices: { A: "Alpha", B: "Beta" }, explanations: { A: "Wrong because x.", B: "Right because y." } }],
      [3, { correct: "B", choices: { A: "Gamma", B: "Delta" }, explanations: { A: "a", B: "b" } }],
    ]);
    const merged = mergeImcqKeyWithExplanations(deck, records);
    expect(merged.map((q) => q.num)).toEqual([1, 2, 3]);
    expect(merged[1]).toMatchObject({ stem: "Full vignette two", correct: "B", whyWrong: { A: "Wrong because x.", B: "Right because y." }, hasImage: true, answerKeyVerified: true });
    expect(merged[2].correct).toBe("B");
    expect(merged[0].stem).toMatch(/short one/);
  });
  it("treats bare figure labels in the deck as matching the handout's described labels", () => {
    const deck = [{ num: 1, stem: "fig", choices: { A: "A", B: "B" } }, { num: 2, stem: "fig2", choices: { A: "0", B: "1" } }];
    const records = new Map([[1, { correct: "B", choices: { A: "A (right midbrain)", B: "B (left pons)" }, explanations: { B: "yes" } }], [2, { correct: "A", choices: { A: "0 (vermis)", B: "1 (paravermal)" }, explanations: {} }]]);
    expect(mergeImcqKeyWithExplanations(deck, records).map((q) => q.correct)).toEqual(["B", "A"]);
  });
  it("refuses a pair whose choices do not line up", () => {
    const deck = [{ num: 1, stem: "v", choices: { A: "Alpha", B: "Beta" } }, { num: 2, stem: "w", choices: { A: "Gamma", B: "Delta" } }];
    const records = new Map([[1, { correct: "A", choices: { A: "Ribosome", B: "Golgi" }, explanations: {} }], [2, { correct: "A", choices: { A: "Mitochondrion", B: "Nucleus" }, explanations: {} }]]);
    expect(() => mergeImcqKeyWithExplanations(deck, records)).toThrow(/do not match/);
  });
});
