import { describe, it, expect } from "vitest";
import { vi } from "vitest";
import { normalizeQuestions, buildMcqPrompt, generateMcqs } from "./mcq.js";

describe("normalizeQuestions", () => {
  const good = {
    stem: "A 45-year-old man presents with polyuria and polydipsia. Which hormone is deficient?",
    choices: { A: "Insulin", B: "Glucagon", C: "Cortisol", D: "TSH" },
    correct: "A",
    explanation: "Type 1 DM = insulin deficiency.",
  };

  it("accepts a valid MCQ and uppercases the correct letter", () => {
    const out = normalizeQuestions({ questions: [{ ...good, correct: "a" }] });
    expect(out).toHaveLength(1);
    expect(out[0].correct).toBe("A");
  });
  it("accepts a bare array too", () => {
    expect(normalizeQuestions([good])).toHaveLength(1);
  });
  it("drops questions whose correct letter isn't among the choices", () => {
    expect(normalizeQuestions([{ ...good, correct: "E" }])).toHaveLength(0);
  });
  it("drops questions with no stem, or fewer than 2 choices", () => {
    expect(normalizeQuestions([{ ...good, stem: "" }])).toHaveLength(0);
    expect(normalizeQuestions([{ ...good, choices: { A: "only one" } }])).toHaveLength(0);
  });
  it("tolerates garbage", () => {
    expect(normalizeQuestions(null)).toEqual([]);
    expect(normalizeQuestions([1, null, "x"])).toEqual([]);
  });
});

describe("buildMcqPrompt", () => {
  const prompt = buildMcqPrompt({
    subject: "Endocrine hormones",
    lectureText: "Insulin is an anabolic hormone secreted by beta cells.",
    difficulty: "hard",
    count: 5,
    examples: [
      { stem: "A patient with X...?", choices: { A: "a", B: "b", C: "c", D: "d" }, correct: "B", explanation: "because" },
    ],
    objectives: [{ code: "SOM.1", objective: "Describe insulin secretion" }],
  });

  it("injects the exam-bank examples as style exemplars", () => {
    expect(prompt).toMatch(/EXAM BANK|EXAMPLE/i);
    expect(prompt).toContain("A patient with X");
  });
  it("includes lecture content, objectives, difficulty and count", () => {
    expect(prompt).toContain("Insulin is an anabolic hormone");
    expect(prompt).toContain("Describe insulin secretion");
    expect(prompt).toMatch(/HARD/);
    expect(prompt).toContain("5");
  });
  it("asks for strict JSON with the questions shape", () => {
    expect(prompt).toMatch(/"questions"/);
    expect(prompt).toMatch(/stem/);
    expect(prompt).toMatch(/choices/);
  });
});

describe("generateMcqs", () => {
  const longText = "Insulin is an anabolic hormone from beta cells. ".repeat(6);
  const q = { stem: "A patient...?", choices: { A: "a", B: "b", C: "c", D: "d" }, correct: "C", explanation: "x" };

  it("builds the prompt from lecture text and normalizes model output", async () => {
    const callAIJSON = vi.fn().mockResolvedValue({ questions: [q, { ...q, correct: "Z" }] });
    const r = await generateMcqs({ lectureText: longText, subject: "Endocrine" }, { callAIJSON });
    expect(callAIJSON).toHaveBeenCalledOnce();
    expect(callAIJSON.mock.calls[0][1]).toContain("Insulin is an anabolic hormone");
    expect(r.questions).toHaveLength(1); // the "Z" correct dropped by normalize
  });
  it("errors without an AI call when lecture text is too short", async () => {
    const callAIJSON = vi.fn();
    const r = await generateMcqs({ lectureText: "short" }, { callAIJSON });
    expect(callAIJSON).not.toHaveBeenCalled();
    expect(r.error).toBeTruthy();
  });
});
