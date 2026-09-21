import { describe, expect, it } from "vitest";
import { minimumQuestionsToObjectiveReadiness, objectivePracticePlan } from "./objectivePractice.js";

describe("objective practice planning", () => {
  it("shows three minimum questions for an unseen objective", () => {
    expect(minimumQuestionsToObjectiveReadiness({})).toBe(3);
  });

  it("increases the minimum when earlier misses must be repaired", () => {
    expect(minimumQuestionsToObjectiveReadiness({
      attempts: 3,
      correct: 2,
      latestCorrect: true,
      sessionCount: 2,
      taskTypeCount: 2,
    })).toBe(2);
  });

  it("requires a new varied answer when volume and accuracy are met in one mode", () => {
    expect(minimumQuestionsToObjectiveReadiness({
      attempts: 3,
      correct: 3,
      latestCorrect: true,
      sessionCount: 1,
      taskTypeCount: 1,
    })).toBe(1);
  });

  it("combines quiz and generated Exam Mode evidence for the lecture objective", () => {
    const plan = objectivePracticePlan(
      [{ id: "o1", code: "DM.1", objective: "Apply insulin physiology" }],
      { objectives: { o1: {
        attempts: 3,
        correct: 3,
        recent: [true, true, true],
        sessions: ["quiz-1", "exam-1"],
        taskTypes: { mechanism: 2, "clinical-application": 1 },
        sources: { quiz: 2, "integrated-exam": 1 },
      } } }
    );
    expect(plan).toMatchObject({ worked: 1, ready: 1, minimumRemaining: 0 });
    expect(plan.rows[0].sources).toEqual({ quiz: 2, "integrated-exam": 1 });
  });
});
