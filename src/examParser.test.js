import { describe, it, expect } from "vitest";
import { buildExamExtractionPrompt, normalizeParsedExamQuestion, attachImagesToExamQuestions, detectFormat, parseNumberedQuestionBankText, groupPairedKeySlides, expectedQuestionCountFromAnswerKey } from "./examParser.js";

describe("paired school answer-key slides", () => {
  const q = `1. A patient has a finding. Which mechanism is most likely?\nA. Alpha\nB. Beta\nC. Gamma\nD. Delta`;
  const keyed = `${q}\nSOM.MK.I.BPM2.2.ER.1.HCB.1010 Discuss hormone production and secretion.`;
  const pages = [1, 2, 3].flatMap((n) => [
    { text: q.replace(/^1/, String(n)), imgCount: 1 },
    { text: keyed.replace(/^1/, String(n)), imgCount: 1 },
  ]);

  it("detects repeated numeric question/key slide pairs before the grid heuristic", () => {
    expect(detectFormat(pages, pages.map((p) => p.text).join("\n"))).toBe("pairedkey");
  });

  it("deduplicates pairs and preserves the linked school objective", () => {
    const groups = groupPairedKeySlides(pages);
    expect(groups).toHaveLength(3);
    expect(groups[0].choices).toEqual({ A: "Alpha", B: "Beta", C: "Gamma", D: "Delta" });
    expect(groups[0].schoolObjectiveCode).toBe("SOM.MK.I.BPM2.2.ER.1.HCB.1010");
    expect(groups[0].schoolObjective).toContain("hormone production");
  });
});

describe("ExamSoft continuous question banks", () => {
  const text = `ExamSoft Practice
Question 1
A patient has a finding. Which mechanism is most likely?
A. First mechanism
B. Second mechanism
C. Third mechanism
D. Fourth mechanism

Question 2
The pathway shown in the figure is abnormal. Which enzyme is deficient?
A. Enzyme one
B. Enzyme two
C. Enzyme three
D. Enzyme four
E. Enzyme five

Question 3
Which laboratory result is expected?
A. High sodium
B. Low sodium
C. High calcium
D. Low calcium

Answer Key
Q1: B — The second mechanism explains the finding.
Q2: E — Enzyme five is required for this reaction.
Q3: A — High sodium is expected.`;

  it("does not misclassify multiple Question blocks per page as a slide deck", () => {
    expect(detectFormat([{ text, imgCount: 0 }], text)).toBe("standard");
  });

  it("extracts variable option counts and joins the separate answer key", () => {
    const questions = parseNumberedQuestionBankText(text, "ExamSoft Practice");
    expect(questions).toHaveLength(3);
    expect(questions[0]).toMatchObject({ correct: "B", topic: "ExamSoft Practice" });
    expect(Object.keys(questions[1].choices)).toEqual(["A", "B", "C", "D", "E"]);
    expect(questions[1].hasImage).toBe(true);
    expect(questions[2].explanation).toContain("High sodium");
  });

  it("accepts cleanup output that changes Question N headings to plain N.", () => {
    const cleaned = text.replace(/Question (\d+)/g, "$1.");
    const questions = parseNumberedQuestionBankText(cleaned, "ExamSoft Practice");
    expect(questions).toHaveLength(3);
    expect(questions.map((q) => q.correct)).toEqual(["B", "E", "A"]);
  });

  it("uses the numbered answer key as an authoritative expected count", () => {
    expect(expectedQuestionCountFromAnswerKey(text)).toBe(3);
    expect(expectedQuestionCountFromAnswerKey("No key here")).toBeNull();
  });
});

describe("buildExamExtractionPrompt", () => {
  it("embeds the source text and asks for the questions JSON shape", () => {
    const p = buildExamExtractionPrompt("QUESTION ONE stem here");
    expect(p).toContain("QUESTION ONE stem here");
    expect(p).toMatch(/"questions"/);
    expect(p).toMatch(/choices/);
  });

  it("tells the model to extract exactly as many lettered choices as the source has, not force 4", () => {
    const p = buildExamExtractionPrompt("text");
    expect(p).not.toMatch(/"A":"\.\.\.","B":"\.\.\.","C":"\.\.\.","D":"\.\.\."\s*}/);
    expect(p).toMatch(/as many lettered choices/i);
  });

  it("asks for table-shaped choices to be flagged with choiceLayout and choiceColumns", () => {
    const p = buildExamExtractionPrompt("text");
    expect(p).toMatch(/choiceLayout/);
    expect(p).toMatch(/choiceColumns/);
    expect(p).toMatch(/table/i);
  });

  it("asks image-referencing questions to be flagged, not dropped or fabricated", () => {
    const p = buildExamExtractionPrompt("text");
    expect(p).toMatch(/hasImage/);
    expect(p).toMatch(/do not (invent|fabricate)/i);
    expect(p).toMatch(/do not drop/i);
  });
});

describe("normalizeParsedExamQuestion", () => {
  it("carries choiceLayout, choiceColumns and hasImage through when present", () => {
    const q = normalizeParsedExamQuestion(
      {
        stem: "Which pattern fits?",
        choices: { A: { PTH: "up" }, B: { PTH: "down" } },
        correct: "A",
        choiceLayout: "table",
        choiceColumns: ["PTH"],
        hasImage: true,
      },
      1
    );
    expect(q.choiceLayout).toBe("table");
    expect(q.choiceColumns).toEqual(["PTH"]);
    expect(q.hasImage).toBe(true);
  });

  it("defaults choiceLayout/choiceColumns to null and hasImage to false when absent", () => {
    const q = normalizeParsedExamQuestion({ stem: "A?", choices: { A: "a", B: "b" }, correct: "A" }, 1);
    expect(q.choiceLayout).toBeNull();
    expect(q.choiceColumns).toBeNull();
    expect(q.hasImage).toBe(false);
  });

  it("keeps a 6-option (A-F) question's choices intact, not truncated", () => {
    const q = normalizeParsedExamQuestion(
      {
        stem: "A?",
        choices: { A: "a", B: "b", C: "c", D: "d", E: "e", F: "f" },
        correct: "F",
      },
      1
    );
    expect(Object.keys(q.choices).sort()).toEqual(["A", "B", "C", "D", "E", "F"]);
  });

  it("returns null for a question with no stem", () => {
    expect(normalizeParsedExamQuestion({ choices: { A: "a", B: "b" } }, 1)).toBeNull();
  });

  it("falls back topic to examTitle then a default label", () => {
    const withExamTitle = normalizeParsedExamQuestion({ stem: "A?", choices: { A: "a", B: "b" }, correct: "A" }, 1, { examTitle: "ER IMCQ 2" });
    expect(withExamTitle.topic).toBe("ER IMCQ 2");
    const withNeither = normalizeParsedExamQuestion({ stem: "A?", choices: { A: "a", B: "b" }, correct: "A" }, 1, {});
    expect(withNeither.topic).toBe("Exam Review");
  });
});

describe("attachImagesToExamQuestions", () => {
  const thyrotropeImg = {
    url: "blob:thyrotrope.jpg",
    kind: "histology",
    shows: "thyrotropes basophils anterior pituitary",
    context: "pituitary adenoma TSH secreting cells",
  };

  it("attaches the best-scoring image to a hasImage question that mentions it", () => {
    const qs = [
      normalizeParsedExamQuestion(
        { stem: "A pituitary adenoma of thyrotropes is shown in the photomicrograph.", choices: { A: "a", B: "b" }, correct: "A", hasImage: true },
        1
      ),
    ];
    const out = attachImagesToExamQuestions(qs, [thyrotropeImg]);
    expect(out[0].image?.url).toBe("blob:thyrotrope.jpg");
  });

  it("leaves a question without hasImage untouched even if text would score", () => {
    const qs = [
      normalizeParsedExamQuestion(
        { stem: "A pituitary adenoma of thyrotropes.", choices: { A: "a", B: "b" }, correct: "A" },
        1
      ),
    ];
    const out = attachImagesToExamQuestions(qs, [thyrotropeImg]);
    expect(out[0].image).toBeUndefined();
  });

  it("leaves hasImage true but no image when nothing scores a match (no wrong picture)", () => {
    const qs = [
      normalizeParsedExamQuestion(
        { stem: "A totally unrelated pharmacology question about beta blockers.", choices: { A: "a", B: "b" }, correct: "A", hasImage: true },
        1
      ),
    ];
    const out = attachImagesToExamQuestions(qs, [thyrotropeImg]);
    expect(out[0].image).toBeUndefined();
    expect(out[0].hasImage).toBe(true);
  });

  it("is a no-op when there are no slide images", () => {
    const qs = [normalizeParsedExamQuestion({ stem: "A?", choices: { A: "a" }, correct: "A", hasImage: true }, 1)];
    expect(attachImagesToExamQuestions(qs, [])).toEqual(qs);
  });
});
