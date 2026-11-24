import { describe, expect, it, vi } from "vitest";
import { importScoreReport } from "./scoreReportImport.js";

// pdf.js text often arrives without line breaks between header fields.
const REPORT = "Louis Maxwell; Username: lmaxwell Strengths and Improvement Opportunities BPM2_NB2_GD_main_F26 Course: 2026-08-BPM501 - Main Exam • 11/16/2026 • Questions: 150 70.00% My Score (91/130) CATEGORY MY SCORE CORRECT 65.56% 59/90 5.2.03 Cerebrovascular disease 54.55% 12/22 5.1.2.2 brain stem 55.56% 5/9 Behavioral Sciences 80.00% 32/40";

function deps(overrides = {}) {
  let results = { existing: { id: "existing", name: "ESoft Quiz 1" } };
  let weak = { nb2: [{ id: "manual-1", concept: "Kept", tags: [] }] };
  return {
    extractText: vi.fn(async () => REPORT),
    readResults: () => results, writeResults: vi.fn(async (_u, value) => { results = value; }),
    readWeak: () => weak, writeWeak: vi.fn(async (_u, value) => { weak = value; }),
    callAIJSON: vi.fn(async () => ({ categories: [
      { category: "Cerebrovascular disease", myScore: 54.55, average: null, correct: 12, total: 22 },
      { category: "Behavioral Sciences", myScore: 80, average: null, correct: 32, total: 40 },
    ] })),
    get results() { return results; }, get weak() { return weak; },
    ...overrides,
  };
}

describe("importScoreReport", () => {
  it("saves the overall score and the categories below 80% for the chosen block", async () => {
    const d = deps();
    const result = await importScoreReport({ file: {}, userId: "u", blockId: "nb2", blockName: "NB 2", lectures: [], objectives: [] }, d);
    expect(result.summary).toMatchObject({ name: "BPM2_NB2_GD_main_F26", percent: 70, correct: 91, total: 130 });
    expect(Object.keys(d.results)).toEqual(expect.arrayContaining(["existing", result.summary.id]));
    expect(result.weakCategories.map(c => c.category)).toEqual(["Cerebrovascular disease"]);
    expect(d.weak.nb2.map(e => e.concept)).toEqual(["Kept", "Cerebrovascular disease"]);
  });

  it("refuses a file that is not a score report without writing anything", async () => {
    const d = deps({ extractText: vi.fn(async () => "Lecture 12 slides about the brainstem.") });
    await expect(importScoreReport({ file: {}, userId: "u", blockId: "nb2" }, d)).rejects.toThrow(/not an ExamSoft score report/i);
    expect(d.writeResults).not.toHaveBeenCalled();
    expect(d.writeWeak).not.toHaveBeenCalled();
  });

  it("keeps the saved score when category extraction fails and reports the reason", async () => {
    const d = deps({ callAIJSON: vi.fn(async () => { throw new Error("bridge offline"); }) });
    const result = await importScoreReport({ file: {}, userId: "u", blockId: "nb2" }, d);
    expect(result.summary.percent).toBe(70);
    expect(result.categoryError).toMatch(/bridge offline/);
    expect(d.writeWeak).not.toHaveBeenCalled();
  });
});
