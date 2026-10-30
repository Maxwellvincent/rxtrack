import { expect, it } from "vitest";
import { schoolCalibratedConfig } from "./schoolDifficulty.js";
import { auditGeneratedQuestions, buildMcqPrompt, buildAtomQuestionsPrompt, buildQuestionAuditPrompt } from "./mcq.js";

it("preserves assigned adaptive depth and the caller allocation", () => {
  const cfg = { difficulty: "hard", objectives: [{ id: "o", _targetOrder: "third-order", _targetQuestionCount: 2 }] };
  expect(schoolCalibratedConfig(cfg).objectives[0]).toMatchObject({ _targetOrder: "third-order", _targetQuestionCount: 2 });
  expect(cfg.objectives[0]._targetOrder).toBe("third-order");
  expect(schoolCalibratedConfig({ ...cfg, reasoningPolicy: "challenge" }).objectives[0]._targetOrder).toBe("third-order");
});

it("calibrates writers and reviewers across compact, full and atom paths", () => {
  for (const prompt of [buildMcqPrompt({}), buildMcqPrompt({ promptProfile: "compact" }), buildAtomQuestionsPrompt({}), buildQuestionAuditPrompt([]), buildQuestionAuditPrompt([], { promptProfile: "compact" })]) {
    expect(prompt).toContain("DEFAULT SCHOOL CALIBRATION");
    expect(prompt).toContain("named maxillary division (V2)");
    expect(prompt).toContain("mandatory depth floor");
  }
});

it.each([undefined, "second-order"])("accepts school recall only without an assigned application target (%s)", async (targetOrder) => {
  const quote = "The maxillary division leaves the cranial cavity through the foramen rotundum.";
  const question = { stem: "The maxillary division (V2) is followed from the cranial cavity into the pterygopalatine fossa. Through which skull opening does this division pass?", choices: { A: "Foramen rotundum", B: "Foramen ovale", C: "Jugular foramen", D: "Optic canal" }, correct: "A", objectiveIds: ["o"], explanation: quote };
  const result = await auditGeneratedQuestions([question], { requireReasoningAudit: true, promptProfile: "compact", lectureText: quote, objectives: [{ id: "o", objective: "Identify the exit route of V2", _targetOrder: targetOrder }] }, { skipRepair: true, reviewAIJSON: async () => ({ reviews: [{ index: 0, approved: true, objectiveAligned: true, issues: [], reasoning: { orderLevel: "first-order", steps: ["Recall the exit of V2"], sourceQuotes: [quote], allStepsRequired: true, connectedChain: true, singleEndpoint: true, choiceShortcut: false } }] }) });
  if (targetOrder) {
    expect(result.questions).toEqual([]);
    expect(result.rejections[0].issues).toContain("insufficient_reasoning_depth");
    return;
  }
  expect(result.questions).toHaveLength(1);
  expect(result.questions[0]).toMatchObject({ orderLevel: "first-order", difficultyCalibration: "school", reasoningAudit: { orderLevel: "first-order" } });
});
