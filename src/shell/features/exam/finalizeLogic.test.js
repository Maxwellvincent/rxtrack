import { describe, it, expect } from "vitest";
import {
  pendingStatsQuestionIds,
  evaluateSessionForLecture,
  computeCleanSessionStreak,
  computeWeakConceptEntry,
} from "./finalizeLogic.js";

function q(questionId, lectureId, correct = "A") {
  return { questionId, lectureId, correct };
}
function ans(questionId, value) {
  return { questionId, value };
}

describe("pendingStatsQuestionIds", () => {
  it("returns answered questions not yet in statsRecordedQuestionIds, skips unanswered", () => {
    const session = {
      answers: [ans("q1", "A"), ans("q2", "B"), ans("q3", "A")],
      sideEffectsCompleted: { statsRecordedQuestionIds: ["q2"] },
    };
    expect(pendingStatsQuestionIds(session)).toEqual(["q1", "q3"]);
  });

  it("returns empty array when all answered questions are already recorded", () => {
    const session = {
      answers: [ans("q1", "A")],
      sideEffectsCompleted: { statsRecordedQuestionIds: ["q1"] },
    };
    expect(pendingStatsQuestionIds(session)).toEqual([]);
  });

  it("questions with no answer at all never appear pending", () => {
    const session = {
      answers: [],
      sideEffectsCompleted: { statsRecordedQuestionIds: [] },
    };
    expect(pendingStatsQuestionIds(session)).toEqual([]);
  });
});

describe("evaluateSessionForLecture", () => {
  it("unanswered question is not graded", () => {
    const session = {
      questions: [q("q1", "lec-1")],
      answers: [],
    };
    expect(evaluateSessionForLecture(session, "lec-1")).toEqual({ questionCount: 0, misses: 0 });
  });

  it("wrong answer counts as a miss", () => {
    const session = {
      questions: [q("q1", "lec-1", "A")],
      answers: [ans("q1", "B")],
    };
    expect(evaluateSessionForLecture(session, "lec-1")).toEqual({ questionCount: 1, misses: 1 });
  });

  it("correct answer does not count as a miss", () => {
    const session = {
      questions: [q("q1", "lec-1", "A")],
      answers: [ans("q1", "A")],
    };
    expect(evaluateSessionForLecture(session, "lec-1")).toEqual({ questionCount: 1, misses: 0 });
  });

  it("returns zero/zero when the session has no questions for that lecture", () => {
    const session = {
      questions: [q("q1", "lec-other", "A")],
      answers: [ans("q1", "A")],
    };
    expect(evaluateSessionForLecture(session, "lec-1")).toEqual({ questionCount: 0, misses: 0 });
  });

  it("mixes hits and misses across multiple questions", () => {
    const session = {
      questions: [q("q1", "lec-1", "A"), q("q2", "lec-1", "A"), q("q3", "lec-1", "A")],
      answers: [ans("q1", "A"), ans("q2", "B")], // q3 unanswered
    };
    expect(evaluateSessionForLecture(session, "lec-1")).toEqual({ questionCount: 2, misses: 1 });
  });
});

// Helper: a session that is `misses`/`questionCount` for lec-1, at a given
// submittedAt (used to control most-recent-first ordering).
function sessionFor(lectureId, questionCount, misses, submittedAt) {
  const questions = [];
  const answers = [];
  for (let i = 0; i < questionCount; i++) {
    const qid = `${lectureId}-q${i}-${submittedAt}`;
    questions.push(q(qid, lectureId, "A"));
    // First `misses` questions get a wrong answer; rest get correct.
    answers.push(ans(qid, i < misses ? "B" : "A"));
  }
  return { submittedAt, questions, answers };
}

describe("computeCleanSessionStreak", () => {
  it("counts consecutive clean sessions from the start, breaks at first non-clean", () => {
    const sessions = [
      sessionFor("lec-1", 10, 1, 300), // clean (10%)
      sessionFor("lec-1", 10, 2, 200), // clean (20%)
      sessionFor("lec-1", 10, 5, 100), // not clean (50%) -> streak stops here
      sessionFor("lec-1", 10, 0, 50),
    ];
    expect(computeCleanSessionStreak(sessions, "lec-1")).toBe(2);
  });

  it("skips zero-question sessions without breaking the streak", () => {
    const sessions = [
      sessionFor("lec-1", 10, 1, 400), // clean
      sessionFor("lec-other", 10, 0, 300), // 0 questions for lec-1 -> skipped
      sessionFor("lec-1", 10, 1, 200), // clean
      sessionFor("lec-1", 10, 5, 100), // not clean -> stop
    ];
    expect(computeCleanSessionStreak(sessions, "lec-1")).toBe(2);
  });

  it("returns 0 for an empty session list", () => {
    expect(computeCleanSessionStreak([], "lec-1")).toBe(0);
  });

  it("returns 0 when the very first clean-eligible session is not clean", () => {
    const sessions = [sessionFor("lec-1", 10, 5, 100)];
    expect(computeCleanSessionStreak(sessions, "lec-1")).toBe(0);
  });
});

describe("computeWeakConceptEntry", () => {
  const blockId = "block-1";
  const lectureId = "lec-1";
  const blockName = "Block One";
  const lectureLabel = "Lecture One";
  const now = 1700000000000;

  it("mastered when streak >= 4", () => {
    const sessions = [
      sessionFor(lectureId, 5, 0, 400),
      sessionFor(lectureId, 5, 0, 300),
      sessionFor(lectureId, 5, 0, 200),
      sessionFor(lectureId, 5, 0, 100),
    ];
    const entry = computeWeakConceptEntry({ sessions, blockId, blockName, lectureId, lectureLabel, existingEntry: null, now });
    expect(entry.masteryLevel).toBe("mastered");
    expect(entry.consecutiveCorrect).toBe(4);
  });

  it("developing when streak is 2-3", () => {
    const sessions = [
      sessionFor(lectureId, 5, 0, 200),
      sessionFor(lectureId, 5, 0, 100),
    ];
    const entry = computeWeakConceptEntry({ sessions, blockId, blockName, lectureId, lectureLabel, existingEntry: null, now });
    expect(entry.masteryLevel).toBe("developing");
    expect(entry.consecutiveCorrect).toBe(2);
  });

  it("struggling when cumulative miss rate >= 40% with >= 3 questions and no recovering streak", () => {
    const sessions = [
      sessionFor(lectureId, 5, 3, 200), // not clean
      sessionFor(lectureId, 5, 2, 100), // not clean
    ];
    const entry = computeWeakConceptEntry({ sessions, blockId, blockName, lectureId, lectureLabel, existingEntry: null, now });
    expect(entry.masteryLevel).toBe("struggling");
    expect(entry.totalAttempts).toBe(10);
    expect(entry.missCount).toBe(5);
  });

  it("returns null when there is insufficient evidence either direction", () => {
    // Single clean session (streak=1, not enough for developing), not enough
    // questions/misses to trigger struggling either.
    const sessions = [sessionFor(lectureId, 2, 0, 100)];
    const entry = computeWeakConceptEntry({ sessions, blockId, blockName, lectureId, lectureLabel, existingEntry: null, now });
    expect(entry).toBeNull();
  });

  it("streak recovery overrides a cumulative-struggling signal: developing wins, not struggling", () => {
    // Lifetime cumulative is bad (lots of old misses), but the 2 most recent
    // sessions are clean.
    const sessions = [
      sessionFor(lectureId, 10, 1, 500), // most recent, clean
      sessionFor(lectureId, 10, 1, 400), // 2nd most recent, clean -> streak = 2
      sessionFor(lectureId, 10, 8, 300), // old, bad
      sessionFor(lectureId, 10, 9, 200), // old, bad
      sessionFor(lectureId, 10, 9, 100), // old, bad
    ];
    // Cumulative: misses = 1+1+8+9+9 = 28, questions = 50 -> 56% miss rate,
    // which alone would be "struggling" (>=3 questions, >=40%).
    const entry = computeWeakConceptEntry({ sessions, blockId, blockName, lectureId, lectureLabel, existingEntry: null, now });
    expect(entry.masteryLevel).toBe("developing");
    expect(entry.consecutiveCorrect).toBe(2);
  });

  it("is deterministic: identical inputs produce byte-identical output", () => {
    const sessions = [
      sessionFor(lectureId, 5, 3, 200),
      sessionFor(lectureId, 5, 2, 100),
    ];
    const existingEntry = {
      lastCorrect: 111,
      questionHistory: ["h1"],
      sourceQuestions: ["s1"],
      dateFirstSeen: 999,
    };
    const args = { sessions, blockId, blockName, lectureId, lectureLabel, existingEntry, now };
    const entry1 = computeWeakConceptEntry(args);
    const entry2 = computeWeakConceptEntry({ ...args, sessions: [...sessions] });
    expect(JSON.stringify(entry1)).toBe(JSON.stringify(entry2));
  });

  it("does not sort or mutate the caller's sessions array in place", () => {
    const sessions = [
      sessionFor(lectureId, 5, 0, 100),
      sessionFor(lectureId, 5, 0, 300),
      sessionFor(lectureId, 5, 0, 200),
    ];
    const original = [...sessions];
    computeWeakConceptEntry({ sessions, blockId, blockName, lectureId, lectureLabel, existingEntry: null, now });
    expect(sessions).toEqual(original);
  });

  it("preserves existingEntry history fields and falls back lastCorrect/dateFirstSeen when unresolved streak is 0", () => {
    const existingEntry = {
      lastCorrect: 555,
      questionHistory: ["h1", "h2"],
      sourceQuestions: ["s1"],
      dateFirstSeen: 12345,
    };
    const sessions = [
      sessionFor(lectureId, 5, 3, 200),
      sessionFor(lectureId, 5, 2, 100),
    ];
    const entry = computeWeakConceptEntry({ sessions, blockId, blockName, lectureId, lectureLabel, existingEntry, now });
    expect(entry.masteryLevel).toBe("struggling");
    expect(entry.consecutiveCorrect).toBe(0);
    expect(entry.lastCorrect).toBe(555);
    expect(entry.questionHistory).toEqual(["h1", "h2"]);
    expect(entry.sourceQuestions).toEqual(["s1"]);
    expect(entry.dateFirstSeen).toBe(12345);
  });
});
