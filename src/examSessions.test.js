import { describe, it, expect } from "vitest";
import {
  sessionBytes,
  createSessionShape,
  mergeAnswer,
  hasRecordedStats,
  withRecordedStats,
  MAX_EXAM_SESSION_BYTES,
} from "./examSessions";

describe("sessionBytes", () => {
  it("measures JSON length of the session", () => {
    const session = { a: 1, b: "x" };
    expect(sessionBytes(session)).toBe(JSON.stringify(session).length);
  });

  it("treats null/undefined as 0-length null", () => {
    expect(sessionBytes(null)).toBe(JSON.stringify(null).length);
    expect(sessionBytes(undefined)).toBe(JSON.stringify(null).length);
  });

  it("returns 0 on unserializable input instead of throwing", () => {
    const circular = {};
    circular.self = circular;
    expect(sessionBytes(circular)).toBe(0);
  });
});

describe("createSessionShape", () => {
  it("builds the full schema with correct defaults", () => {
    const session = createSessionShape({
      sessionId: "s1",
      blockId: "b1",
      lectureIds: ["l1", "l2"],
      format: "exam",
      questions: [{ questionId: "q1" }],
    });

    expect(session).toEqual({
      schemaVersion: 1,
      sessionId: "s1",
      blockId: "b1",
      lectureIds: ["l1", "l2"],
      format: "exam",
      status: "in_progress",
      questions: [{ questionId: "q1" }],
      answers: [],
      sideEffectsCompleted: {
        statsRecordedQuestionIds: [],
        weakConceptsRecorded: false,
      },
      startedAt: null,
      deadline: null,
      sourceType: "generated",
      sourceFile: null,
      studyMode: "balanced",
      submittedAt: null,
      rev: 0,
    });
  });

  it("defaults lectureIds/questions to empty arrays and startedAt/deadline to null when omitted", () => {
    const session = createSessionShape({
      sessionId: "s2",
      blockId: "b1",
      format: "practice",
    });
    expect(session.lectureIds).toEqual([]);
    expect(session.questions).toEqual([]);
    expect(session.startedAt).toBeNull();
    expect(session.deadline).toBeNull();
  });

  it("accepts explicit startedAt/deadline", () => {
    const session = createSessionShape({
      sessionId: "s3",
      blockId: "b1",
      format: "exam",
      startedAt: 1000,
      deadline: 4600000,
    });
    expect(session.startedAt).toBe(1000);
    expect(session.deadline).toBe(4600000);
  });

  it("exports the size guard constant", () => {
    expect(MAX_EXAM_SESSION_BYTES).toBe(900_000);
  });
});

describe("mergeAnswer", () => {
  const base = { questionId: "q1", value: "A", answeredAt: 100, seq: 1, writerId: "w1" };

  it("adds the answer when no existing answer for that questionId", () => {
    const result = mergeAnswer([], base);
    expect(result).toEqual([base]);
  });

  it("leaves other questions' answers alone", () => {
    const other = { questionId: "q2", value: "B", answeredAt: 50, seq: 1, writerId: "w1" };
    const incoming = { questionId: "q1", value: "C", answeredAt: 200, seq: 1, writerId: "w1" };
    const result = mergeAnswer([other, base], incoming);
    expect(result).toContainEqual(other);
    expect(result).toContainEqual(incoming);
    expect(result).toHaveLength(2);
  });

  it("replaces when incoming has a later answeredAt", () => {
    const incoming = { ...base, value: "B", answeredAt: 200 };
    const result = mergeAnswer([base], incoming);
    expect(result).toEqual([incoming]);
  });

  it("is a no-op when incoming has an earlier answeredAt", () => {
    const incoming = { ...base, value: "B", answeredAt: 50 };
    const result = mergeAnswer([base], incoming);
    expect(result).toEqual([base]);
  });

  it("tie-breaks on seq when answeredAt is equal, larger seq wins", () => {
    const incoming = { ...base, value: "B", seq: 2 };
    const result = mergeAnswer([base], incoming);
    expect(result).toEqual([incoming]);
  });

  it("is a no-op when answeredAt equal and incoming seq is smaller", () => {
    const higherSeq = { ...base, seq: 5 };
    const incoming = { ...base, value: "B", seq: 2 };
    const result = mergeAnswer([higherSeq], incoming);
    expect(result).toEqual([higherSeq]);
  });

  it("tie-breaks on writerId (lexicographically greater wins) when answeredAt and seq are equal", () => {
    const existing = { ...base, writerId: "a" };
    const incoming = { ...base, value: "B", writerId: "z" };
    const result = mergeAnswer([existing], incoming);
    expect(result).toEqual([incoming]);
  });

  it("is a no-op when answeredAt and seq equal and incoming writerId is lexicographically smaller", () => {
    const existing = { ...base, writerId: "z" };
    const incoming = { ...base, value: "B", writerId: "a" };
    const result = mergeAnswer([existing], incoming);
    expect(result).toEqual([existing]);
  });
});

describe("hasRecordedStats", () => {
  it("returns false when the array is empty", () => {
    expect(hasRecordedStats([], "q1")).toBe(false);
  });

  it("returns false when the array is undefined/null", () => {
    expect(hasRecordedStats(undefined, "q1")).toBe(false);
    expect(hasRecordedStats(null, "q1")).toBe(false);
  });

  it("returns false when questionId is absent from a non-empty array", () => {
    expect(hasRecordedStats(["q2", "q3"], "q1")).toBe(false);
  });

  it("returns true when questionId is present", () => {
    expect(hasRecordedStats(["q1", "q2"], "q1")).toBe(true);
  });
});

describe("withRecordedStats", () => {
  it("adds questionId to an empty array", () => {
    expect(withRecordedStats([], "q1")).toEqual(["q1"]);
  });

  it("adds questionId to an undefined/null array", () => {
    expect(withRecordedStats(undefined, "q1")).toEqual(["q1"]);
    expect(withRecordedStats(null, "q1")).toEqual(["q1"]);
  });

  it("appends questionId, keeping existing entries", () => {
    expect(withRecordedStats(["q1"], "q2")).toEqual(["q1", "q2"]);
  });

  it("is idempotent — adding an already-present id doesn't grow the array", () => {
    const result = withRecordedStats(["q1", "q2"], "q1");
    expect(result).toEqual(["q1", "q2"]);
    expect(result).toHaveLength(2);
  });
});
