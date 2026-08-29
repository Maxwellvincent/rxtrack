import { describe, expect, it } from "vitest";
import { summarizeBankUpload, tagBankQuestions } from "./questionBankIngest.js";

const opts = { blockId: "b1", filename: "2024-final.pdf", idgen: (() => { let n = 0; return () => `q${++n}`; })(), now: () => "2026-07-29T00:00:00.000Z" };

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
    });
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
