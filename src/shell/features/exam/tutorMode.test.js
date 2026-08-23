import { describe, expect, it, vi } from "vitest";
import { buildTutorPrompt, explainQuestion } from "./tutorMode.js";

function makeQuestion(overrides = {}) {
  return {
    questionId: "q1",
    stem: "A 54-year-old man presents with crushing substernal chest pain radiating to the jaw.",
    choices: { A: "Aspirin", B: "Ibuprofen", C: "Acetaminophen", D: "Naproxen" },
    correct: "A",
    explanation: "Aspirin is first-line for suspected ACS.",
    lectureLabel: "Cardiology — ACS",
    ...overrides,
  };
}

describe("buildTutorPrompt", () => {
  it("grounds the prompt in the frozen question fields", () => {
    const prompt = buildTutorPrompt(makeQuestion());
    expect(prompt).toContain("crushing substernal chest pain radiating to the jaw");
    expect(prompt).toContain("Correct answer: A");
    expect(prompt).toContain("Aspirin is first-line for suspected ACS.");
    expect(prompt).toContain("Cardiology — ACS");
  });
});

describe("explainQuestion", () => {
  it("calls deps.callAI with a prompt grounded in the question's actual fields", async () => {
    const callAI = vi.fn().mockResolvedValue("Here's how to parse it...");
    const question = makeQuestion();

    const result = await explainQuestion(question, { callAI });

    expect(callAI).toHaveBeenCalledTimes(1);
    const [systemPrompt, userPrompt] = callAI.mock.calls[0];
    expect(typeof systemPrompt).toBe("string");
    expect(userPrompt).toContain(question.stem);
    expect(userPrompt).toContain("Correct answer: A");
    expect(result).toEqual({ text: "Here's how to parse it..." });
  });

  it("catches a thrown rejection from callAI and returns {error} instead of throwing", async () => {
    const callAI = vi.fn().mockRejectedValue(new Error("provider down"));
    const question = makeQuestion();

    await expect(explainQuestion(question, { callAI })).resolves.toEqual({ error: "provider down" });
  });
});
