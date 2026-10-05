import { describe, expect, it } from "vitest";
import { minimumQuestionsToObjectiveReadiness, objectivePracticePlan, objectivesWithPracticeEvidence } from "./objectivePractice.js";

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

  it("counts one correct exam answer as worked, but not as mastered", () => {
    const plan = objectivePracticePlan(
      [{ id: "o1", code: "DM.1", objective: "Apply insulin physiology" }],
      { objectives: { o1: {
        attempts: 1, correct: 1, recent: [true], sessions: ["exam-1"],
        taskTypes: { mechanism: 1 }, sources: { "integrated-exam": 1 },
      } } }
    );
    expect(plan).toMatchObject({ worked: 1, ready: 0, developing: 1, untested: 0 });
  });
});

describe("evidence-driven objective progression", () => {
  it("overrides a stale mastered label after misses and retires an easy ready objective", () => {
    const result = objectivesWithPracticeEvidence([{ id: "easy", status: "struggling" }, { id: "gap", status: "mastered" }], { objectives: {
      easy: { attempts: 3, correct: 3, recent: [true, true, true], sessions: ["s1", "s2"], taskTypes: { mechanism: 2, recognition: 1 } },
      gap: { attempts: 3, correct: 1, recent: [true, false, false], sessions: ["s1", "s2"], taskTypes: { mechanism: 3 } },
    } });
    expect(result[0]).toMatchObject({ status: "mastered", _practiceRemaining: 0 });
    expect(result[1]).toMatchObject({ status: "struggling" });
  });
  it("requests integration after successful separately reviewed application", () => {
    const [row] = objectivePracticePlan([{ id: "o1", bloom_level: 3 }], { objectives: { o1: {
      attempts: 1, correct: 1, recent: [true], orderLevels: { "second-order": { attempts: 1, correct: 1 } },
    } } }).rows;
    expect(row.targetOrder).toBe("third-order");
    expect(row.demonstrated).toEqual(["second-order"]);
  });
  it("returns to fresh application after recent misses instead of advancing on one old success", () => {
    const [row] = objectivePracticePlan([{ id: "o1", bloom_level: 3 }], { objectives: { o1: {
      attempts: 4, correct: 1, recent: [true, false, false, false], orderLevels: { "second-order": { attempts: 4, correct: 1 } },
    } } }).rows;
    expect(row.targetOrder).toBe("second-order");
  });
  it("does not revive stale objective counters when all journal evidence was excluded", () => {
    const [row] = objectivePracticePlan([{ id: "o1", attempts: 10, correctCount: 10, status: "mastered" }], { objectives: { o1: { attempts: 0, correct: 0 } } }).rows;
    expect(row.attempts).toBe(0);
    expect(row.ready).toBe(false);
  });
});
