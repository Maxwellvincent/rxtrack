import { describe, expect, it, vi } from "vitest";
import { buildMissDiagnosisPrompt, diagnoseQuestionMiss, normalizeMissDiagnostic, reasoningGuidance } from "./questionReasoning.js";

describe("question reasoning diagnostics", () => {
  it("builds a patient/ask-first prompt and preserves the learner's own reasoning", () => {
    const prompt = buildMissDiagnosisPrompt({ question: { stem: "Fast patient?", choices: { A: "OAA" }, correct: "A" }, patientInterpretation: "Fasting", requestedTarget: "Regulator", learnerPrediction: "Gluconeogenesis" });
    expect(prompt).toContain("FIRST point where reasoning diverged");
    expect(prompt).toContain("Learner's patient model: Fasting");
    expect(prompt).toContain("Learner's pre-choice prediction: Gluconeogenesis");
  });

  it("requires patient and ask input and validates provider output", async () => {
    const callAIJSON = vi.fn(async () => ({ patient: "fasting", asksFor: "regulator", bridge: "acetyl-CoA activates PC", primaryType: "depth", depth: "regulation-cofactor" }));
    expect((await diagnoseQuestionMiss({}, { callAIJSON })).error).toContain("patient model");
    const result = await diagnoseQuestionMiss({ patientInterpretation: "fasting", requestedTarget: "regulator" }, { callAIJSON });
    expect(result.diagnostic).toMatchObject({ primaryType: "depth", depth: "regulation-cofactor" });
    expect(callAIJSON).toHaveBeenCalledOnce();
  });

  it("drops invalid AI labels and targets generation from learner-confirmed miss patterns", () => {
    expect(normalizeMissDiagnostic({ primaryType: "diagnosis", depth: "ultra" })).toMatchObject({ primaryType: null, depth: null, anki: { kind: "none" } });
    expect(reasoningGuidance({ depth: { count: 6 }, content: { count: 2 } }, 15)).toContain("one-level-deeper");
    expect(reasoningGuidance({}, 15)).toContain("5-question reasoning chunks");
  });
});
