import { describe, it, expect } from "vitest";
import { buildExamExtractionPrompt, normalizeParsedExamQuestion, attachImagesToExamQuestions } from "./examParser.js";

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
