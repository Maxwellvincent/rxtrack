import { expect, it } from "vitest";
import { questionClarityIssues } from "./questionClarity.js";
import { locallyUsableQuestions, buildMcqPrompt, buildQuestionAuditPrompt } from "./mcq.js";

const flawed = {
  stem: "An enzyme is applied selectively to the anterior basement membrane of an isolated cornea. Microscopy confirms that the overlying epithelium and underlying substantia propria remain intact. Which microscopic finding should be absent from the treated specimen?",
  choices: { A: "Endothelium", B: "Lamellae", C: "Epithelial layers", D: "Random collagen fibrils" }, correct: "D",
  explanation: "The selectively removed layer contains randomly oriented collagen fibrils. The remaining layers are preserved.",
};
it("withholds an implied removal even if its explanation supplies the missing event", () => {
  expect(questionClarityIssues(flawed)).toEqual(["inconsistent_vignette"]);
  expect(locallyUsableQuestions([flawed])).toEqual([]);
});
it("allows an explicit experimental effect through the clarity screen without certifying its medical key", () => {
  expect(questionClarityIssues({ ...flawed, stem: flawed.stem.replace("is applied selectively to", "selectively digests") })).toEqual([]);
  expect(questionClarityIssues({ ...flawed, stem: flawed.stem.replace("Microscopy confirms", "The enzyme removes the targeted layer. Microscopy confirms") })).toEqual([]);
});
it("does not mistake applying an enzyme with a non-loss endpoint for the demonstrated defect", () => {
  expect(questionClarityIssues({ ...flawed, stem: "An enzyme is applied to the specimen. Which assay would measure enzyme activity?" })).toEqual([]);
});
it("requires causal clarity and clinical preference in both generation and reviewer formats", () => {
  for (const prompt of [buildMcqPrompt({}), buildQuestionAuditPrompt([flawed]), buildQuestionAuditPrompt([flawed], { promptProfile: "compact" })]) {
    expect(prompt).toContain("Applying an enzyme does not establish digestion");
    expect(prompt).toContain("Prefer patient presentations");
    expect(prompt).toContain("Distinguish adjacent histological layers");
  }
});
