import { describe, expect, it } from "vitest";
import { buildStyleProfile } from "./styleProfile.js";

const question = (stem, sourceFile = "ExamSoft.pdf") => ({
  stem,
  sourceFile,
  choices: { A: "a", B: "b", C: "c", D: "d" },
  correct: "A",
  answerKeyVerified: true,
});

describe("buildStyleProfile", () => {
  it("aggregates the complete verified bank and separates source tiers", () => {
    const examples = [
      ...Array.from({ length: 60 }, (_, i) => question(`Official ${i}`)),
      question("Homework", "Homework Week 1.pdf"),
      { ...question("Unverified"), answerKeyVerified: false },
    ];
    const profile = buildStyleProfile(examples, { now: 123 });
    expect(profile.sampleSize).toBe(61);
    expect(profile.sourceCounts.examsoft).toBe(60);
    expect(profile.sourceCounts.homework).toBe(1);
    expect(profile.officialStyle.sampleSize).toBe(60);
    expect(profile.updatedAt).toBe(123);
  });
});
