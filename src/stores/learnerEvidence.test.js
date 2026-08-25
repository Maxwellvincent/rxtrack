import { describe, expect, it } from "vitest";
import { applyEvidence, applyReflection } from "./learnerEvidence.js";

describe("learner evidence", () => {
  it("aggregates objective, atom, lecture, source, and landmine evidence", () => {
    const model = applyEvidence(null, {
      source: "quiz", lectureId: "l1", objectiveIds: ["o1"], atomKey: "a1",
      correct: false, misconception: "landmine", difficulty: "expert", at: 10,
    });
    expect(model.total).toBe(1);
    expect(model.objectives.o1).toMatchObject({ attempts: 1, correct: 0, landmines: 1 });
    expect(model.atoms.a1.lastDifficulty).toBe("expert");
    expect(model.lectures.l1.attempts).toBe(1);
    expect(model.sources.quiz.attempts).toBe(1);
  });

  it("tracks response time, answer changes, and self-classified process errors", () => {
    const timed = applyEvidence(null, { correct: false, responseMs: 90000, answerChanges: 1, at: 10 });
    const reflected = applyReflection(timed, "misread-lead-in");
    expect(reflected.testTaking).toMatchObject({ timedAnswers: 1, totalResponseMs: 90000, answerChanges: 1 });
    expect(reflected.testTaking.reasons["misread-lead-in"]).toBe(1);
  });
});
