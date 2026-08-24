import { describe, it, expect } from "vitest";
import { classify, confidenceFromPercent, isLandmine, summarize, atomsToReview, CONFIDENT_THRESHOLD } from "./calibration.js";

describe("classify", () => {
  it("confidence >= 4 and correct → confident-right", () => {
    expect(classify({ confidence: 4, correct: true })).toBe("confident-right");
    expect(classify({ confidence: 5, correct: true })).toBe("confident-right");
  });
  it("confidence >= 4 and wrong → confident-wrong (the landmine quadrant)", () => {
    expect(classify({ confidence: 4, correct: false })).toBe("confident-wrong");
    expect(classify({ confidence: 5, correct: false })).toBe("confident-wrong");
  });
  it("confidence <= 3 and correct → unsure-right", () => {
    expect(classify({ confidence: 1, correct: true })).toBe("unsure-right");
    expect(classify({ confidence: 3, correct: true })).toBe("unsure-right");
  });
  it("confidence <= 3 and wrong → unsure-wrong", () => {
    expect(classify({ confidence: 2, correct: false })).toBe("unsure-wrong");
  });
});

describe("isLandmine", () => {
  it("is true only for confident (>=4) and wrong", () => {
    expect(isLandmine({ confidence: 5, correct: false })).toBe(true);
    expect(isLandmine({ confidence: 4, correct: false })).toBe(true);
  });
  it("is false for confident-right, unsure-wrong, unsure-right", () => {
    expect(isLandmine({ confidence: 5, correct: true })).toBe(false);
    expect(isLandmine({ confidence: 3, correct: false })).toBe(false);
    expect(isLandmine({ confidence: 1, correct: true })).toBe(false);
  });
});

describe("summarize", () => {
  // Worked example (independent source of truth):
  // A c5 ✓ confident-right | B c5 ✗ landmine | C c4 ✗ landmine
  // D c3 ✓ unsure-right    | E c1 ✗ unsure-wrong | F c5 ✓ confident-right
  const records = [
    { concept: "A", confidence: 5, correct: true },
    { concept: "B", confidence: 5, correct: false },
    { concept: "C", confidence: 4, correct: false },
    { concept: "D", confidence: 3, correct: true },
    { concept: "E", confidence: 1, correct: false },
    { concept: "F", confidence: 5, correct: true },
  ];
  const s = summarize(records);

  it("curve has one row per level 1..5, ordered", () => {
    expect(s.curve.map((r) => r.level)).toEqual([1, 2, 3, 4, 5]);
  });
  it("curve counts + accuracy match the worked example", () => {
    const byLevel = Object.fromEntries(s.curve.map((r) => [r.level, r]));
    expect(byLevel[1]).toMatchObject({ count: 1, correctCount: 0, accuracy: 0 });
    expect(byLevel[2]).toMatchObject({ count: 0, correctCount: 0, accuracy: null });
    expect(byLevel[3]).toMatchObject({ count: 1, correctCount: 1, accuracy: 1 });
    expect(byLevel[4]).toMatchObject({ count: 1, correctCount: 0, accuracy: 0 });
    expect(byLevel[5].count).toBe(3);
    expect(byLevel[5].correctCount).toBe(2);
    expect(byLevel[5].accuracy).toBeCloseTo(2 / 3, 5);
  });
  it("landmines are the confident-wrong records, in order", () => {
    expect(s.landmines).toEqual([
      { concept: "B", confidence: 5 },
      { concept: "C", confidence: 4 },
    ]);
  });
  it("quadrant tallies match", () => {
    expect(s.quadrants).toEqual({
      "confident-right": 2,
      "confident-wrong": 2,
      "unsure-right": 1,
      "unsure-wrong": 1,
    });
  });
  it("empty input → empty curve rows and no landmines", () => {
    const e = summarize([]);
    expect(e.landmines).toEqual([]);
    expect(e.curve.every((r) => r.count === 0 && r.accuracy === null)).toBe(true);
    expect(e.quadrants).toEqual({
      "confident-right": 0,
      "confident-wrong": 0,
      "unsure-right": 0,
      "unsure-wrong": 0,
    });
  });
});

describe("confidenceFromPercent", () => {
  it("maps Deep Learn's three buckets onto the 1-5 scale", () => {
    expect(confidenceFromPercent(50)).toBe(2);
    expect(confidenceFromPercent(70)).toBe(3);
    expect(confidenceFromPercent(90)).toBe(5);
  });

  it("keeps the confident boundary where it was — only 90 counts as sure", () => {
    expect(confidenceFromPercent(90)).toBeGreaterThanOrEqual(CONFIDENT_THRESHOLD);
    expect(confidenceFromPercent(70)).toBeLessThan(CONFIDENT_THRESHOLD);
    expect(confidenceFromPercent(50)).toBeLessThan(CONFIDENT_THRESHOLD);
  });

  it("so a 90%-sure miss is a landmine and a 70%-sure miss is not", () => {
    expect(isLandmine({ confidence: confidenceFromPercent(90), correct: false })).toBe(true);
    expect(isLandmine({ confidence: confidenceFromPercent(70), correct: false })).toBe(false);
  });
});

describe("atomsToReview", () => {
  it("includes any missed atom, not just landmines", () => {
    const out = atomsToReview([
      { atomKey: "a", concept: "A", confidence: 2, correct: false },
      { atomKey: "b", concept: "B", confidence: 3, correct: true },
    ]);
    expect(out.map((r) => r.atomKey)).toEqual(["a"]);
  });

  it("sorts landmines (confident-wrong) before plain misses", () => {
    const out = atomsToReview([
      { atomKey: "unsure-miss", concept: "U", confidence: 2, correct: false },
      { atomKey: "landmine", concept: "L", confidence: 5, correct: false },
    ]);
    expect(out.map((r) => r.atomKey)).toEqual(["landmine", "unsure-miss"]);
  });

  it("ignores records with no atomKey — nothing to link back to", () => {
    const out = atomsToReview([{ concept: "no atom link", confidence: 5, correct: false }]);
    expect(out).toEqual([]);
  });

  it("dedupes by atomKey, keeping only the last attempt this session", () => {
    const out = atomsToReview([
      { atomKey: "a", concept: "A", confidence: 5, correct: false },
      { atomKey: "a", concept: "A", confidence: 3, correct: true },
    ]);
    expect(out).toEqual([]); // corrected on retry within the session — nothing to review
  });

  it("keeps a re-miss after an earlier correct answer in the same session", () => {
    const out = atomsToReview([
      { atomKey: "a", concept: "A", confidence: 3, correct: true },
      { atomKey: "a", concept: "A", confidence: 5, correct: false },
    ]);
    expect(out).toHaveLength(1);
  });

  it("is empty for a clean session", () => {
    expect(atomsToReview([{ atomKey: "a", correct: true, confidence: 3 }])).toEqual([]);
    expect(atomsToReview([])).toEqual([]);
  });
});
