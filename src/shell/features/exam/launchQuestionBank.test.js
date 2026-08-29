import { describe, expect, it, vi } from "vitest";
import { examDurationMs, examDurationMinutes } from "./examTiming.js";
import { launchQuestionBankSession, prepareQuestionBankQuestions } from "./launchQuestionBank.js";

const QUESTIONS = Array.from({ length: 30 }, (_, index) => ({
  id: `q${index + 1}`,
  stem: `Question ${index + 1}?`,
  choices: { A: "Alpha", B: "Beta", C: "Gamma" },
  correct: "B",
  explanation: "Because beta.",
}));

describe("exam timing", () => {
  it("budgets exactly 90 seconds per question", () => {
    expect(examDurationMs(30)).toBe(45 * 60_000);
    expect(examDurationMinutes(30)).toBe(45);
    expect(examDurationMinutes(15)).toBe(22.5);
    expect(examDurationMinutes(100)).toBe(150);
  });
});

describe("launchQuestionBankSession", () => {
  it("creates a timed 30-question session with a 45-minute persisted deadline", async () => {
    const createExamSession = vi.fn().mockResolvedValue({ ok: true });
    const before = Date.now();
    const result = await launchQuestionBankSession(
      { userId: "u1", blockId: "b1", filename: "ESoft.pdf", questions: QUESTIONS, format: "exam" },
      { createExamSession }
    );
    const after = Date.now();

    expect(result.ok).toBe(true);
    const [, session] = createExamSession.mock.calls[0];
    expect(session.sourceType).toBe("question-bank");
    expect(session.sourceFile).toBe("ESoft.pdf");
    expect(session.questions).toHaveLength(30);
    expect(session.startedAt).toBeGreaterThanOrEqual(before);
    expect(session.startedAt).toBeLessThanOrEqual(after);
    expect(session.deadline).toBe(session.startedAt + 45 * 60_000);
    expect(session.questions[0]).toMatchObject({
      source: "Original school question",
      sourceType: "question-bank",
      lectureId: null,
    });
  });

  it("creates untimed practice sessions", async () => {
    const createExamSession = vi.fn().mockResolvedValue({ ok: true });
    await launchQuestionBankSession(
      { userId: "u1", blockId: "b1", filename: "ER.pdf", questions: QUESTIONS, format: "practice" },
      { createExamSession }
    );
    const [, session] = createExamSession.mock.calls[0];
    expect(session.startedAt).toBeNull();
    expect(session.deadline).toBeNull();
  });

  it("blocks a bank with an unkeyed question instead of silently scoring it", async () => {
    const createExamSession = vi.fn();
    const result = await launchQuestionBankSession(
      { userId: "u1", blockId: "b1", filename: "bad.pdf", questions: [{ ...QUESTIONS[0], correct: null }] },
      { createExamSession }
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/keyed answer/);
    expect(createExamSession).not.toHaveBeenCalled();
  });

  it("gives duplicate source ids unique stable session question ids", () => {
    const prepared = prepareQuestionBankQuestions(
      [{ ...QUESTIONS[0], id: "q1" }, { ...QUESTIONS[1], id: "q1" }],
      { blockId: "b1", filename: "ER.pdf" }
    );
    expect(new Set(prepared.map((q) => q.questionId)).size).toBe(2);
  });
});
