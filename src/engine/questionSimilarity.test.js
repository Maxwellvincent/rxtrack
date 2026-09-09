import { describe, expect, it } from "vitest";
import { areNearDuplicateQuestions, questionSimilarity, uniqueQuestions } from "./questionSimilarity.js";

const first = {
  stem: "A 45-year-old male presents with intermittent abdominal pain. Examination shows tenderness in the upper mid-abdomen. Which of the following best describes the location of the peritoneum in this patient?",
  choices: { A: "Parietal peritoneum", B: "Visceral peritoneum", C: "Peritoneal cavity", D: "Mesentery", E: "Lesser sac" },
  objectiveIds: ["peritoneum"],
};

describe("semantic question deduplication", () => {
  it("treats demographic and option-order changes as the same reasoning route", () => {
    const paraphrase = {
      ...first,
      stem: "A 55-year-old man has intermittent abdominal pain and tenderness in the upper mid-abdomen. Which option best describes the location of the peritoneum in this patient?",
      choices: { A: "Lesser sac", B: "Mesentery", C: "Peritoneal cavity", D: "Visceral peritoneum", E: "Parietal peritoneum" },
    };
    expect(questionSimilarity(first, paraphrase)).toBeGreaterThan(0.9);
    expect(areNearDuplicateQuestions(first, paraphrase)).toBe(true);
    expect(uniqueQuestions([first, paraphrase])).toEqual([first]);
  });

  it("keeps genuinely different clinical routes", () => {
    const different = {
      stem: "A patient undergoes abdominal surgery and develops severe pain when the abdominal wall is touched. Which membrane carries somatic sensory innervation?",
      choices: { A: "Parietal peritoneum", B: "Visceral peritoneum", C: "Greater omentum", D: "Mesentery", E: "Lesser sac" },
      objectiveIds: ["peritoneum"],
    };
    expect(areNearDuplicateQuestions(first, different)).toBe(false);
  });
});
