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

const chiari = {
 stem: "A newborn has difficulty swallowing and a small posterior cranial fossa. Which anatomic displacement is expected?",
 choices: { A: "Optic chiasm into the sella", B: "Vermis and medulla through the foramen magnum" }, correct: "B",
 explanation: "The patient's symptoms of raised intracranial pressure (headaches, nausea) and difficulty swallowing support the diagnosis.",
};
it("withholds invented patient symptoms even when the key is anatomically plausible", () => {
 expect(questionClarityIssues(chiari)).toContain("inconsistent_vignette");
 expect(locallyUsableQuestions([chiari])).toEqual([]);
});
it("permits general teaching facts and reasoning from the actual supplied findings", () => {
 expect(questionClarityIssues({ ...chiari, explanation: "The small posterior fossa and difficulty swallowing support hindbrain involvement. Headaches and nausea can occur in older patients." })).toEqual([]);
 expect(questionClarityIssues({ ...chiari, stem: "An older child has headaches, nausea, difficulty swallowing and a small posterior fossa. Which displacement is expected?" })).toEqual([]);
});
it("rejects developmental-delay framing in a newborn", () => {
 expect(questionClarityIssues({ ...chiari, stem: "A newborn has developmental delays. Which displacement is expected?", explanation: "Anatomic review." })).toContain("inconsistent_vignette");
});
it("requires source-supported differentiating clues in standard and compact audits and drafting", () => {
 for (const prompt of [buildMcqPrompt({}), buildQuestionAuditPrompt([chiari]), buildQuestionAuditPrompt([chiari], { promptProfile: "compact" })]) {
  expect(prompt).toContain("SOURCE CLUE SUFFICIENCY");
  expect(prompt).toContain("without the explanation or supplied key");
  expect(prompt).toContain("never attribute additional symptoms");
 }
});

it('does not credit complete-inventory subtraction as application even after a model approval',()=>{
 const question={stem:'An ocular pathology specimen is separated into its complete tissue layers. The inventory confirms that the fibrous tunic and vascular tunic were recovered intact. One additional layer is missing, and the original specimen contained every layer of the eyeball. Which of the following is the missing layer?',orderLevel:'second-order'};
 const reasoning={status:'verified',version:2,orderLevel:'second-order',connectedChain:true,singleEndpoint:true,choiceShortcut:false,allStepsRequired:true,steps:['Identify complete tunics','Subtract recovered layers'],sourceQuotes:['The eyeball consists of fibrous, vascular and retinal tunics.']};
 expect(classifyQuestionOrder(question)).toBe('first-order');
 expect(verifyReasoningReview({reasoning},question,{lectureText:reasoning.sourceQuotes[0]})).toBeNull();
 expect(hasCurrentReasoningAudit({...question,reasoningAudit:reasoning})).toBe(false);
 expect(classifyQuestionOrder({stem:'An inventory confirms a removed tissue layer. Which functional deficit follows this removal?',orderLevel:'second-order'})).toBe('second-order');
});


it("withholds the two live NB31 lookup shortcuts despite a claimed application audit", () => {
  const motorMap = { stem: "During an operation, brief electrical stimulation of one region of the primary motor cortex produces movement of the contralateral hand without movement of the face or leg. Which of the following cortical regions was most likely stimulated?", choices: { A: "Dorsolateral", B: "Ventrolateral", C: "Ventromedial", D: "Primary sensory cortex", E: "Dorsomedial" }, orderLevel: "second-order" };
  const route = { stem: "Imaging of a patient with impaired voluntary movement shows a focal interruption of descending corticospinal fibers. The fibers are intact while passing through the corona radiata but are disrupted before reaching the crus cerebri. Which of the following structures is most likely damaged?", choices: { A: "Internal capsule", B: "Cerebral cortex", C: "Corona radiata", D: "Medullary pyramid", E: "Basilar pons" }, orderLevel: "second-order" };
  const reasoning = { status: "verified", version: 2, orderLevel: "second-order", connectedChain: true, singleEndpoint: true, choiceShortcut: false, allStepsRequired: true, steps: ["Interpret the observation", "Recall the location"], sourceQuotes: ["The supplied source supports the named mapping relationship."] };
  for (const question of [motorMap, route]) {
    expect(classifyQuestionOrder(question)).toBe("first-order");
    expect(verifyReasoningReview({ reasoning }, question, {})).toBeNull();
    expect(hasCurrentReasoningAudit({ ...question, reasoningAudit: reasoning })).toBe(false);
  }
  expect(classifyQuestionOrder({ ...motorMap, stem: "After a motor cortex lesion, a patient develops weakness. Which additional finding best distinguishes cortical from peripheral injury?" })).toBe("second-order");
  expect(classifyQuestionOrder({ ...route, stem: "A corticospinal lesion causes contralateral weakness and an additional source-supported finding. Which structure explains the combined pattern?" })).toBe("second-order");
});
