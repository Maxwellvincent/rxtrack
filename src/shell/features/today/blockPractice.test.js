import { describe, it, expect } from "vitest";
import { blockPracticeSummary } from "./blockPractice.js";
const lectures = [{ id: "a", blockId: "er" }, { id: "b", blockId: "er" }, { id: "other", blockId: "cpr" }];
const session = (overrides = {}) => ({ sessionId: "s", blockId: "er", format: "exam", status: "submitted", submittedAt: 1,
  questions: [{ questionId: "q", lectureId: "a", correct: "A" }], answers: [{ questionId: "q", value: "A" }], ...overrides });
describe("blockPracticeSummary", () => {
  it("weights by answers rather than averaging lecture percentages and isolates the block", () => {
    const result = blockPracticeSummary("er", lectures, { a: { answered: 10, correct: 10 }, b: { answered: 90, correct: 60 }, other: { answered: 100, correct: 100 } });
    expect(result).toMatchObject({ answered: 100, correct: 70, accuracy: 0.7 });
  });
  it("does not count finalized exam answers a second time", () => {
    const s = session({ sideEffectsCompleted: { statsRecordedQuestionIds: ["q"] } });
    expect(blockPracticeSummary("er", lectures, { a: { answered: 1, correct: 1 } }, [s, s])).toMatchObject({ answered: 1, correct: 1, timedAccuracy: 1 });
  });
  it("includes unlinked school-bank answers and unrecorded session answers", () => {
    const bank = session({ sessionId: "bank", questions: [{ questionId: "q", sourceType: "question-bank", correct: "A" }], sideEffectsCompleted: { statsRecordedQuestionIds: ["q"] } });
    expect(blockPracticeSummary("er", lectures, {}, [session(), bank])).toMatchObject({ answered: 2, correct: 2 });
  });
  it("excludes skips from answered volume but includes them in timed scoring", () => {
    const skipped = session({ answers: [], sideEffectsCompleted: { statsRecordedQuestionIds: ["q"] } });
    expect(blockPracticeSummary("er", lectures, { a: { answered: 1, correct: 0 } }, [skipped])).toMatchObject({ answered: 0, accuracy: null, timedAccuracy: 0, timedQuestions: 1 });
  });
  it("handles empty history without pretending no data means 0% accuracy", () => {
    expect(blockPracticeSummary("er")).toMatchObject({ answered: 0, accuracy: null, timedAccuracy: null });
  });
  it("only uses the latest five submitted timed sessions for timed performance", () => {
    const sessions = Array.from({ length: 6 }, (_, i) => session({ sessionId: String(i), submittedAt: i, answers: i ? [{ questionId: "q", value: "A" }] : [] }));
    sessions.push(session({ sessionId: "practice", format: "practice", answers: [] }));
    sessions.push(session({ sessionId: "other", blockId: "cpr" }));
    expect(blockPracticeSummary("er", lectures, {}, sessions)).toMatchObject({ answered: 5, timedCount: 5, timedAccuracy: 1 });
  });
});
