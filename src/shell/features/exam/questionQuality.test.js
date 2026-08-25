import { describe, expect, it } from "vitest";
import { isSemanticDuplicate, questionFingerprint, schoolStyleSimilarity } from "./questionQuality.js";

describe("question quality", () => {
  it("detects paraphrased stems sharing the same clinical concepts", () => {
    const a = { stem: "A 45-year-old patient has hypercalcemia, kidney stones, and elevated parathyroid hormone. Which mechanism explains this finding?" };
    const b = { stem: "A 45 year old with kidney stones has elevated calcium and parathyroid hormone. Which mechanism best explains the findings?" };
    expect(isSemanticDuplicate(b, [a])).toBe(true);
    expect(questionFingerprint(a)).toContain("hypercalcemia");
  });

  it("scores school-like structure higher than a short recall prompt", () => {
    const exemplar = { stem: "A 42-year-old patient comes to the physician with fatigue. Laboratory studies show low T4 and high TSH. Which mechanism best explains these findings?", choices: { A: "a", B: "b", C: "c", D: "d", E: "e" } };
    const styled = { ...exemplar, stem: exemplar.stem.replace("fatigue", "cold intolerance") };
    const recall = { stem: "What is TSH?", choices: { A: "a", B: "b" } };
    expect(schoolStyleSimilarity(styled, [exemplar])).toBeGreaterThan(schoolStyleSimilarity(recall, [exemplar]));
  });
});
