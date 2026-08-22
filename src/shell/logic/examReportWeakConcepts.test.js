import { describe, it, expect, vi } from "vitest";
import {
  looksLikeExamReport,
  buildCategoryScorePrompt,
  normalizeCategoryScores,
  isWeakCategory,
  matchCategoryToLecture,
  buildWeakConceptEntriesFromReport,
  mergeExamReportConcepts,
  analyzeExamReportWeakConcepts,
} from "./examReportWeakConcepts.js";

const REPORT_SNIPPET = `
Overall, you scored below the class average.

Nutrition and aging
 (SCHOOL OF MEDICINE/BASIC SCIENCES/Basic Principles of Medic.../BIOCHEMISTRY BPM2/)
                                                                             0.00%     39.49%   0/2

Steroid hormone metabolism
 (SCHOOL OF MEDICINE/BASIC SCIENCES/Basic Principles of Medic.../BIOCHEMISTRY BPM2/)
                                                                             0.00%     45.94%   0/3

Thyroid
 (SCHOOL OF MEDICINE/BASIC SCIENCES/Basic Principles of Medic.../PHYSIOLOGY-BPM2/)
                                                                         66.67%        50.59%   2/3
`;

const PLAIN_EXAM_KEY = `
1. A patient presents with polyuria. Which hormone is deficient?
A) Insulin B) Glucagon C) Cortisol D) TSH
Answer: A
`;

describe("looksLikeExamReport", () => {
  it("recognizes a score-table report", () => {
    expect(looksLikeExamReport(REPORT_SNIPPET)).toBe(true);
  });
  it("does not flag a plain question-and-answer exam key", () => {
    expect(looksLikeExamReport(PLAIN_EXAM_KEY)).toBe(false);
  });
});

describe("buildCategoryScorePrompt", () => {
  it("embeds the source text and asks for the categories JSON shape", () => {
    const p = buildCategoryScorePrompt(REPORT_SNIPPET);
    expect(p).toContain("Nutrition and aging");
    expect(p).toMatch(/"categories"/);
    expect(p).toMatch(/myScore/);
  });
  it("tells the model to skip umbrella/container rows", () => {
    const p = buildCategoryScorePrompt(REPORT_SNIPPET);
    expect(p).toMatch(/SCHOOL OF MEDICINE/);
    expect(p).toMatch(/umbrella|container/i);
  });
});

describe("normalizeCategoryScores", () => {
  it("keeps well-formed rows and drops junk", () => {
    const out = normalizeCategoryScores({
      categories: [
        { category: "Nutrition and aging", myScore: 0, average: 39.49, correct: 0, total: 2 },
        { category: "", myScore: 50, average: 50, correct: 1, total: 2 }, // no name
        { category: "Bad row", myScore: "not a number", average: 50, correct: 1, total: 2 },
        { category: "Zero total", myScore: 0, average: 0, correct: 0, total: 0 }, // total<=0
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0].category).toBe("Nutrition and aging");
  });
  it("dedupes by category name, keeping the first", () => {
    const out = normalizeCategoryScores([
      { category: "Thyroid", myScore: 66, average: 50, correct: 2, total: 3 },
      { category: "thyroid", myScore: 0, average: 0, correct: 0, total: 1 },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].myScore).toBe(66);
  });
  it("tolerates a bare array or garbage", () => {
    expect(normalizeCategoryScores(null)).toEqual([]);
    expect(normalizeCategoryScores([1, null, "x"])).toEqual([]);
  });
});

describe("isWeakCategory", () => {
  it("flags a category meaningfully below average", () => {
    expect(isWeakCategory({ myScore: 0, average: 39.49, total: 2 })).toBe(true);
  });
  it("does not flag a category near or above average", () => {
    expect(isWeakCategory({ myScore: 45, average: 50, total: 3 })).toBe(false);
    expect(isWeakCategory({ myScore: 80, average: 50, total: 3 })).toBe(false);
  });
  it("respects a custom gap threshold", () => {
    expect(isWeakCategory({ myScore: 45, average: 50, total: 3 }, { gapThreshold: 3 })).toBe(true);
  });
});

describe("matchCategoryToLecture", () => {
  const lectures = [
    { id: "lec1", lectureTitle: "Nutrition and Aging" },
    { id: "lec2", lectureTitle: "Steroid Hormone Metabolism" },
    { id: "lec3", lectureTitle: "Female Reproductive System I" },
  ];
  it("matches a category to its title-overlapping lecture", () => {
    const m = matchCategoryToLecture("Nutrition and aging", lectures);
    expect(m.lecture.id).toBe("lec1");
  });
  it("returns null when nothing overlaps enough", () => {
    expect(matchCategoryToLecture("Cardiac arrhythmias", lectures)).toBeNull();
  });
});

describe("buildWeakConceptEntriesFromReport", () => {
  const lectures = [{ id: "lec1", lectureTitle: "Nutrition and Aging" }];
  const categories = normalizeCategoryScores({
    categories: [
      { category: "Nutrition and aging", myScore: 0, average: 39.49, correct: 0, total: 2 },
      { category: "Thyroid", myScore: 66, average: 50, correct: 2, total: 3 }, // above average, skipped
    ],
  });

  it("builds one entry per weak category, matched to its lecture", () => {
    const entries = buildWeakConceptEntriesFromReport({ categories, lectures, blockId: "block1", now: "2026-08-22T00:00:00.000Z" });
    expect(entries).toHaveLength(1);
    expect(entries[0].concept).toBe("Nutrition and aging");
    expect(entries[0].linkedLecIds).toEqual(["lec1"]);
    expect(entries[0].masteryLevel).toBe("struggling");
    expect(entries[0].tags).toContain("exam-report");
  });

  it("has a stable id derived from blockId + category, not random", () => {
    const [a] = buildWeakConceptEntriesFromReport({ categories, lectures, blockId: "block1" });
    const [b] = buildWeakConceptEntriesFromReport({ categories, lectures, blockId: "block1" });
    expect(a.id).toBe(b.id);
  });

  it("leaves linkedLecIds empty when no lecture matches", () => {
    const [entry] = buildWeakConceptEntriesFromReport({ categories, lectures: [], blockId: "block1" });
    expect(entry.linkedLecIds).toEqual([]);
  });
});

describe("mergeExamReportConcepts", () => {
  it("replaces an existing exam-report entry with the same id instead of duplicating", () => {
    const existing = [
      { id: "examcat-b1-nutrition-and-aging", concept: "Nutrition and aging", missCount: 2 },
      { id: "wc-from-deeplearn-1", concept: "radial nerve innervation", missCount: 1 },
    ];
    const next = mergeExamReportConcepts(existing, [
      { id: "examcat-b1-nutrition-and-aging", concept: "Nutrition and aging", missCount: 1 },
    ]);
    expect(next).toHaveLength(2);
    const replaced = next.find((c) => c.id === "examcat-b1-nutrition-and-aging");
    expect(replaced.missCount).toBe(1); // the NEW (improved) value survives, not the old higher one
    expect(next.some((c) => c.id === "wc-from-deeplearn-1")).toBe(true);
  });
});

describe("analyzeExamReportWeakConcepts", () => {
  it("skips a plain exam key without calling the AI", async () => {
    const callAIJSON = vi.fn();
    const r = await analyzeExamReportWeakConcepts({ text: PLAIN_EXAM_KEY, blockId: "b1" }, { callAIJSON });
    expect(callAIJSON).not.toHaveBeenCalled();
    expect(r.skipped).toBe(true);
    expect(r.entries).toEqual([]);
  });

  it("extracts categories and builds weak-concept entries for a real report", async () => {
    const callAIJSON = vi.fn().mockResolvedValue({
      categories: [{ category: "Nutrition and aging", myScore: 0, average: 39.49, correct: 0, total: 2 }],
    });
    const lectures = [{ id: "lec1", lectureTitle: "Nutrition and Aging" }];
    const r = await analyzeExamReportWeakConcepts(
      { text: REPORT_SNIPPET, lectures, blockId: "b1", now: "2026-08-22T00:00:00.000Z" },
      { callAIJSON }
    );
    expect(callAIJSON).toHaveBeenCalledOnce();
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0].linkedLecIds).toEqual(["lec1"]);
  });
});
