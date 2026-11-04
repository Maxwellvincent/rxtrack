import { describe, expect, it } from "vitest";
import { buildMcqPrompt, buildRepairPrompt, objectiveConstructionPrompt } from "./mcq.js";
import { linkedConceptInstruction } from "./linkedConceptCoverage.js";

const objective = { id: "clinical", objective: "Describe clinical manifestations of cerebellar disease", _targetOrder: "second-order" };
const lectureText = "Clinical manifestations of cerebellar disease include gait ataxia and limb dysmetria.\n" + "Neighboring anatomical terminology. ".repeat(100);

describe("objective-first construction", () => {
  it("retrieves each objective independently of competing tagged facts", () => {
    const cfg = { objectives: [objective], lectureText, atoms: [{ term: "Neighbor", content: "Neighboring anatomical terminology." }] };
    const cards = objectiveConstructionPrompt(cfg);
    expect(cards).toContain("gait ataxia and limb dysmetria");
    expect(cards).toContain('"objectiveId":"clinical"');
    const prompt = buildMcqPrompt({ ...cfg, promptProfile: "compact" });
    expect(prompt.match(/OBJECTIVE-FIRST CONSTRUCTION CARDS/g)).toHaveLength(1);
    expect(prompt).toContain("Use the independently retrieved objective cards above");
  });

  it("lets the assigned objective take priority over a tagged definition", () => {
    expect(linkedConceptInstruction([{ term: "Tumor prevalence", content: "A frequency fact", objectiveIds: ["clinical"] }]))
      .toContain("Choose another supported concept when a suggested term would force recall or a different objective");
  });

  it("allows an off-target draft to change its relationship during repair", () => {
    const prompt = buildRepairPrompt([{ question: { stem: "An off-target demographic lookup" }, issues: ["objective_mismatch"] }], { objectives: [objective], lectureText });
    expect(prompt).toContain("For objective_mismatch, replace the off-target relationship and endpoint");
    expect(prompt).toContain("OBJECTIVE-FIRST CONSTRUCTION CARDS");
    expect(prompt).toContain("An independent reviewer will verify each repair");
  });
});
