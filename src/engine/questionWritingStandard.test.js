import { describe, expect, it } from "vitest";
import { QUESTION_WRITING_BENCHMARKS, questionWritingBenchmarkPrompt } from "./questionWritingStandard.js";
import { buildAtomQuestionsPrompt, buildMcqPrompt, buildQuestionAuditPrompt } from "./mcq.js";

describe("user-supplied question-writing benchmark", () => {
  it("keeps all five reference constructions without importing answers or inflating their orders", () => {
    expect(QUESTION_WRITING_BENCHMARKS).toHaveLength(5);
    expect(QUESTION_WRITING_BENCHMARKS.map(item => item.order)).toEqual(["second-order", "second-order", "first-order", "second-order", "second-order"]);
    expect(QUESTION_WRITING_BENCHMARKS.some(item => item.correct || item.objectiveIds)).toBe(false);
  });
  it("does not inject CNS examples into an unrelated lecture", () => {
    expect(questionWritingBenchmarkPrompt({ objectives: [{ objective: "Explain insulin secretion" }] })).not.toContain("USER-SUPPLIED WRITING BENCHMARKS");
  });
  it("focuses source-supported examples on the active task, with a bounded prompt", () => {
    const prompt = questionWritingBenchmarkPrompt({ objectives: [{ objective: "Localize ventricular obstruction" }], lectureText: "Hydrocephalus arises from aqueduct obstruction or impaired arachnoid CSF absorption." });
    expect(prompt).toContain("csf-obstruction");
    expect(prompt).not.toContain("cellular-edema");
    expect(prompt).toContain("not official school questions or medical evidence");
  });
  it("shares the writing standard across normal generation, atom practice and independent review", () => {
    const cfg = { objectives: [{ id: "o1", objective: "Explain cytotoxic edema after ischemia" }], atoms: [{ term: "Edema", content: "Ischemia causes intracellular swelling with an intact BBB." }], lectureText: "Ischemia causes cytotoxic edema." };
    for (const prompt of [buildMcqPrompt(cfg), buildAtomQuestionsPrompt(cfg), buildQuestionAuditPrompt([], cfg)]) {
      expect(prompt).toContain("QUESTION WRITING STANDARD");
      expect(prompt).toContain("cellular-edema");
      expect(prompt).toContain("one focused endpoint");
    }
  });
});
