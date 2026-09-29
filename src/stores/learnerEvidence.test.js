import { describe, expect, it } from "vitest";
import { applyEvidence, applyReflection, questionEvidenceKey } from "./learnerEvidence.js";

describe("learner evidence", () => {
  it("replaces a miss reason without adding a second reflection", () => {
    const first = applyReflection(null, "knowledge-gap");
    const changed = applyReflection(first, "time-pressure", "knowledge-gap");
    expect(changed.testTaking.reasons).toEqual({ "knowledge-gap": 0, "time-pressure": 1 });
    expect(applyReflection(changed, "time-pressure", "time-pressure")).toBe(changed);
  });
  it("aggregates objective, atom, lecture, source, and landmine evidence", () => {
    const model = applyEvidence(null, {
      source: "quiz", lectureId: "l1", objectiveIds: ["o1"], atomKey: "a1",
      correct: false, misconception: "landmine", difficulty: "expert", at: 10,
      orderLevel: "third-order",
    });
    expect(model.total).toBe(1);
    expect(model.objectives.o1).toMatchObject({ attempts: 1, correct: 0, landmines: 1 });
    expect(model.atoms.a1.lastDifficulty).toBe("expert");
    expect(model.lectures.l1.attempts).toBe(1);
    expect(model.sources.quiz.attempts).toBe(1);
    expect(model.orderLevels["third-order"].attempts).toBe(1);
  });

  it("keeps integrated-exam objective evidence usable without a lecture link", () => {
    const model = applyEvidence(null, {
      source: "integrated-exam", sessionKey: "exam-1", blockId: "block-1",
      objectiveIds: ["o1"], correct: true, taskType: "mechanism", at: 10,
    });
    expect(model.objectives.o1).toMatchObject({
      attempts: 1, correct: 1, sessions: ["exam-1"],
      taskTypes: { mechanism: 1 }, sources: { "integrated-exam": 1 },
    });
    expect(Object.keys(model.lectures)).toEqual([]);
  });

  it("tracks response time, answer changes, and self-classified process errors", () => {
    const timed = applyEvidence(null, { correct: false, responseMs: 90000, answerChanges: 1, at: 10 });
    const reflected = applyReflection(timed, "misread-lead-in");
    expect(reflected.testTaking).toMatchObject({ timedAnswers: 1, totalResponseMs: 90000, answerChanges: 1 });
    expect(reflected.testTaking.reasons["misread-lead-in"]).toBe(1);
  });

  it("keeps a bounded recent-answer window for repair decisions", () => {
    let model = null;
    for (let index = 0; index < 10; index += 1) {
      model = applyEvidence(model, { objectiveIds: ["o1"], correct: index >= 2, at: index + 1 });
    }
    expect(model.objectives.o1.recent).toEqual([true, true, true, true, true, true, true, true]);
  });

  it("counts an exact repeated question as reinforcement instead of new readiness evidence", () => {
    const first = applyEvidence(null, {
      source: "quiz", sessionKey: "session-1", questionKey: "q-1",
      objectiveIds: ["o1"], correct: true, taskType: "mechanism", at: 10,
    });
    const repeated = applyEvidence(first, {
      source: "quiz", sessionKey: "session-2", questionKey: "q-1",
      objectiveIds: ["o1"], correct: true, taskType: "clinical-application", at: 20,
    });
    expect(repeated.total).toBe(2);
    expect(repeated.objectives.o1).toMatchObject({
      attempts: 1,
      correct: 1,
      sessions: ["session-1"],
      taskTypes: { mechanism: 1 },
      questionKeys: [questionEvidenceKey("q-1")],
      reinforcements: 1,
      reinforcementCorrect: 1,
    });
  });

  it("lets a repeated miss revoke the latest positive signal without adding an attempt", () => {
    const first = applyEvidence(null, { questionKey: "q-1", objectiveIds: ["o1"], correct: true, at: 10 });
    const repeatedMiss = applyEvidence(first, { questionKey: "q-1", objectiveIds: ["o1"], correct: false, at: 20 });
    expect(repeatedMiss.objectives.o1.attempts).toBe(1);
    expect(repeatedMiss.objectives.o1.correct).toBe(1);
    expect(repeatedMiss.objectives.o1.recent).toEqual([true, false]);
    expect(repeatedMiss.objectives.o1.reinforcements).toBe(1);
  });
});
