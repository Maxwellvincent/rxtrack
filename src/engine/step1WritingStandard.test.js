import { expect, it } from "vitest";
import { STEP1_WRITING_RESOURCES } from "./step1WritingStandard.js";
import { buildAtomQuestionsPrompt, buildMcqPrompt, buildQuestionAuditPrompt } from "./mcq.js";

it("uses official public resources with dated provenance", () => {
  expect(STEP1_WRITING_RESOURCES).toHaveLength(3);
  for (const source of STEP1_WRITING_RESOURCES) {
    expect(new URL(source.url).hostname).toMatch(/^(www\.)?(nbme|usmle)\.org$/);
    expect(source.reviewed).toBe("2026-10-17");
  }
});

it("applies the standard to both writers and both reviewer formats", () => {
  const cfg = { atoms: [{ term: "Test", content: "A supplied relationship." }], objectives: [{ id: "o1", objective: "Explain the supplied relationship" }] };
  for (const prompt of [buildAtomQuestionsPrompt(cfg), buildMcqPrompt(cfg), buildQuestionAuditPrompt([], cfg), buildQuestionAuditPrompt([], { ...cfg, promptProfile: "compact" })]) {
    expect(prompt).toContain("STEP 1 EDITORIAL STANDARD");
    expect(prompt).toContain("before reading the choices");
    expect(prompt).toContain("lecture excerpts establish factual truth");
    expect(prompt).toContain("not an official NBME taxonomy");
    expect(prompt).toContain("without overriding school calibration");
  }
});
