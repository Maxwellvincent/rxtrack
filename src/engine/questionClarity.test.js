import { expect, it } from "vitest";
import { questionClarityIssues } from "./questionClarity.js";
import { locallyUsableQuestions, buildMcqPrompt, buildQuestionAuditPrompt } from "./mcq.js";
import { classifyQuestionOrder, verifyReasoningReview, hasCurrentReasoningAudit } from "./questionOrder.js";
import { isPairedCartilageRecall } from "./questionClarity.js";

const flawed = {
  stem: "An enzyme is applied selectively to the anterior basement membrane of an isolated cornea. Microscopy confirms that the overlying epithelium and underlying substantia propria remain intact. Which microscopic finding should be absent from the treated specimen?",
  choices: { A: "Endothelium", B: "Lamellae", C: "Epithelial layers", D: "Random collagen fibrils" }, correct: "D",
  explanation: "The selectively removed layer contains randomly oriented collagen fibrils. The remaining layers are preserved.",
};
it("withholds an implied removal even if its explanation supplies the missing event", () => {
  expect(questionClarityIssues(flawed)).toEqual(["inconsistent_vignette"]);
  expect(locallyUsableQuestions([flawed])).toEqual([]);
});

it("does not let elaborate category-removal wording or a reviewer claim promote recall", () => {
  const question = { stem: "During preparation of a laryngeal specimen, every cartilage occurring as left and right homologs is removed. The remaining cartilages are verified to be single midline framework elements. No cartilage has been fragmented. Which of the following groups remains in the specimen?", orderLevel: "second-order" };
  const reasoning = { status: "verified", version: 2, connectedChain: true, singleEndpoint: true, choiceShortcut: false, orderLevel: "second-order", allStepsRequired: true, steps: ["Identify paired cartilages", "Choose remaining unpaired cartilages"], sourceQuotes: ["The unpaired cartilages are thyroid, cricoid and epiglottis."] };
  expect(isPairedCartilageRecall(question)).toBe(true);
  expect(classifyQuestionOrder(question)).toBe("first-order");
  expect(verifyReasoningReview({ reasoning }, question, { lectureText: reasoning.sourceQuotes[0] })).toBeNull();
  expect(hasCurrentReasoningAudit({ ...question, reasoningAudit: reasoning })).toBe(false);
  expect(hasCurrentReasoningAudit({ ...question, reasoningAudit: { ...reasoning, orderLevel: "first-order" } })).toBe(true);
});

it("keeps functional clinical consequences available for independent reasoning review", () => {
  expect(isPairedCartilageRecall({ stem: "A patient has hoarseness after nerve injury involving paired cartilages. Which muscle action is impaired?" })).toBe(false);
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

it('rejects cranial-nerve lead-ins with exclusively embryologic answer categories', () => {
 const q={stem:'A patient has difficulty coughing and swallowing. Which cranial nerve is affected?',choices:{A:'Second pouch',B:'First groove',C:'Third pouch'}};
 expect(questionClarityIssues(q)).toContain('invalid_answer_choices');
 expect(questionClarityIssues({...q,stem:'Which pharyngeal pouch forms this structure?'})).not.toContain('invalid_answer_choices');
});
