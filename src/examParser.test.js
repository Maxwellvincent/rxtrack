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

  it("tracks the original PDF page for image-bearing questions", () => {
    const paged = text.replace("Question 2", "[PAGE_BREAK:2]\nQuestion 2");
    const questions = parseNumberedQuestionBankText(paged, "School Homework");
    expect(questions[0].sourcePage).toBe(1);
    expect(questions[1]).toMatchObject({ sourcePage: 2, hasImage: true });
  });

  it("accepts cleanup output that changes Question N headings to plain N.", () => {
    const cleaned = text.replace(/Question (\d+)/g, "$1.");
    const questions = parseNumberedQuestionBankText(cleaned, "ExamSoft Practice");
    expect(questions).toHaveLength(3);
    expect(questions.map((q) => q.correct)).toEqual(["B", "E", "A"]);
  });

  it("parses multiple independently numbered homework sets in one PDF", () => {
    const makeSet = (label, keys) => `${keys.map((key, index) => `${index + 1}. ${label} patient ${index + 1} has a sufficiently detailed clinical presentation. Which finding is expected?\nA. Alpha\nB. Beta\nC. Gamma\nD. Delta`).join("\n\n")}\n\nAnswer key: ${keys.map((key, index) => `${index + 1} ${key}`).join(", ")}\n\nExplanations:\n${keys.map((_, index) => `${index + 1}. ${label} explanation for this clinical question.`).join("\n")}`;
    const questions = parseNumberedQuestionBankText(`${makeSet("Nutrition", ["B", "A", "D"])}\n\n${makeSet("Hormones", ["D", "C", "A"])}`, "Week 1 homework");
    expect(questions).toHaveLength(6);
    expect(questions.map((question) => question.correct)).toEqual(["B", "A", "D", "D", "C", "A"]);
  });

  it("uses the numbered answer key as an authoritative expected count", () => {
    expect(expectedQuestionCountFromAnswerKey(text)).toBe(3);
    expect(expectedQuestionCountFromAnswerKey("No key here")).toBeNull();
  });

  it("parses compact comma-separated school keys without AI", () => {
    const source = [1, 2, 3].map(n => `${n}. Clinical question ${n} with enough detail to be valid?\nA. First\nB. Second\nC. Third\nD. Fourth`).join("\n\n") + "\n\nAnswer key:\n1 B, 2 C, 3 A.";
    const questions = parseNumberedQuestionBankText(source, "School practice");
    expect(questions.map(question => question.correct)).toEqual(["B", "C", "A"]);
    expect(expectedQuestionCountFromAnswerKey(source)).toBe(3);
  });

  it("ignores form-feed page numbers and recognizes expanded answer headings", () => {
    const source = [
      "1. First clinical question with enough detail to parse?\nA. One\nB. Two\nC. Three\nD. Four",
      "2. Second clinical question with enough detail to parse?\nA. One\nB. Two\nC. Three\nD. Four",
      "3. Third clinical question with enough detail to parse?\nA. One\nB. Two\nC. Three\nD. Four",
      "\f1\n4. Fourth clinical question with enough detail to parse?\nA. One\nB. Two\nC. Three\nD. Four",
      "ANSWER KEY AND EXPLANATION",
      "1. First repeated question?\nA. One\nB. Two\nC. Three\nD. Four\nAnswer Key: A.",
      "2. Second repeated question?\nA. One\nB. Two\nC. Three\nD. Four\nAnswer Key: B.",
      "3. Third repeated question?\nA. One\nB. Two\nC. Three\nD. Four\nAnswer Key: C.",
      "\f2\n4. Fourth repeated question?\nA. One\nB. Two\nC. Three\nD. Four\nAnswer Key: D.",
    ].join("\n\n");
    const questions = parseNumberedQuestionBankText(source, "Physiology");
    expect(questions).toHaveLength(4);
    expect(questions.map(question => question.correct)).toEqual(["A", "B", "C", "D"]);
    expect(expectedQuestionCountFromAnswerKey(source)).toBe(4);
  });

  it("recognizes inline school rationales as an authoritative answer key", () => {
    const inline = ["Answer: A. first", "Answer Key: Option B. second", "Answer: C. third"].join("\n");
    expect(expectedQuestionCountFromAnswerKey(inline)).toBe(3);
  });

  it("parses ExamSoft Question #: headings, inline checkmarks, and rationales", () => {
    const annotated = [1, 2, 3].map((number) => `Question #: ${number}\n\nClinical stem ${number} with enough detail to be a valid question?\n\n A. Distractor\n ✓B. Correct answer\n C. Distractor\n D. Distractor\nRationale: Explanation ${number}.`).join("\n\n____\n\n");
    const questions = parseNumberedQuestionBankText(annotated, "BPM2 Quiz");
    expect(questions).toHaveLength(3);
    expect(questions.map((question) => question.correct)).toEqual(["B", "B", "B"]);
    expect(questions[1].explanation).toBe("Explanation 2.");
    expect(expectedQuestionCountFromAnswerKey(annotated)).toBe(3);
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
