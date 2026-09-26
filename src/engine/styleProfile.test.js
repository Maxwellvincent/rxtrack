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

  it("keeps ExamSoft option mix and report-derived weak outcomes for generation context", () => {
    const questions = [
      { ...question("Miss one", "ESoftQuiz2-DM-Report.pdf"), choices: { A: "a", B: "b", C: "c", D: "d", E: "e" }, sourceAttemptCorrect: false, schoolLearningOutcomes: "GI System · Anatomy of the Gastrointestinal System" },
      { ...question("Miss two", "ESoftQuiz2-DM-Report.pdf"), choices: { A: "a", B: "b", C: "c", D: "d", E: "e" }, sourceAttemptCorrect: false, schoolLearningOutcomes: "GI System · Anatomy of the Gastrointestinal System" },
      { ...question("Correct", "ESoftQuiz2-DM-Report.pdf"), sourceAttemptCorrect: true, schoolLearningOutcomes: "GI System" },
    ];
    const profile = buildStyleProfile(questions);
    expect(profile.version).toBe(2);
    expect(profile.optionCounts[5]).toBe(2);
    expect(profile.reportOutcomePerformance).toContainEqual({ label: "Anatomy of the Gastrointestinal System", attempts: 2, correct: 0, accuracy: 0 });
    expect(profile.reportOutcomePerformance.find((entry) => entry.label === "GI System")).toMatchObject({ attempts: 3, correct: 1, accuracy: 33 });
  });
});
