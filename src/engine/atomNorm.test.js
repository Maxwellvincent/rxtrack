import { describe, expect, it } from "vitest";
import { partitionAtomsForRound } from "./atomNorm.js";

describe("partitionAtomsForRound hierarchy", () => {
  it("surfaces anchors and core atoms before supporting and discriminator details", () => {
    const { toQuiz } = partitionAtomsForRound([
      { term: "photosensitivity clue", importanceTier: "discriminator" },
      { term: "Porphyrias", importanceTier: "anchor" },
      { term: "AIP", importanceTier: "core" },
      { term: "heme feedback", importanceTier: "supporting" },
    ], {}, new Map());
    expect(toQuiz.map((atom) => atom.term)).toEqual(["Porphyrias", "AIP", "heme feedback", "photosensitivity clue"]);
  });
});
