import { describe, expect, it } from "vitest";
import { shuffleChoices } from "./mcq.js";

describe("shuffleChoices", () => {
  it("moves the discrimination set with its choices", () => {
    const q = { choices: { A: "CBT", B: "SSRI", C: "Benzodiazepine", D: "Propranolol", E: "Haloperidol" }, correct: "B", discriminationSet: ["A", "B", "C", "D"] };
    for (let i = 0; i < 20; i += 1) {
      const out = shuffleChoices(q);
      expect(out.choices[out.correct]).toBe("SSRI");
      expect(out.discriminationSet.map(letter => out.choices[letter]).sort()).toEqual(["Benzodiazepine", "CBT", "Propranolol", "SSRI"]);
    }
  });
  it("adds no set when the question has none", () => {
    expect(shuffleChoices({ choices: { A: "x", B: "y" }, correct: "A" })).not.toHaveProperty("discriminationSet");
  });
});
