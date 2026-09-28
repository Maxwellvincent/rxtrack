import { describe, expect, it } from "vitest";
import { objectiveFacetCoveragePrompt } from "./objectiveFacets.js";

describe("objectiveFacetCoveragePrompt", () => {
  it("requires facet decomposition, repeated linkage to one objective, and count-aware breadth", () => {
    const objective = {
      id: "bh4",
      objective: "Evaluate BH4 functions in amino acid and neurotransmitter synthesis, deficiency pathophysiology, manifestations, and nutrition management.",
    };
    const prompt = objectiveFacetCoveragePrompt([objective], 5);
    expect(prompt).toContain("internally split it into distinct, independently assessable facets");
    expect(prompt).toContain("For this 5-question request");
    expect(prompt).toContain("multiple questions, each with the SAME single primary objective ID");
    expect(prompt).toContain("nutrition management");
  });

  it("does not add an objective-coverage instruction when objectives are absent", () => {
    expect(objectiveFacetCoveragePrompt([], 5)).toBe("");
  });
});
