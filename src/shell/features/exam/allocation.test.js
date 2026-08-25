import { describe, it, expect } from "vitest";
import { allocateQuestions, makeSeededRandom } from "./allocation.js";

const BLOCK_ID = "block-1";

function sumCounts(counts) {
  return Object.values(counts).reduce((a, b) => a + b, 0);
}

describe("makeSeededRandom", () => {
  it("produces identical sequences for the same seed", () => {
    const a = makeSeededRandom("session-abc");
    const b = makeSeededRandom("session-abc");
    const seqA = [a(), a(), a(), a(), a()];
    const seqB = [b(), b(), b(), b(), b()];
    expect(seqA).toEqual(seqB);
  });

  it("all values fall in [0, 1)", () => {
    const r = makeSeededRandom("seed-x");
    for (let i = 0; i < 50; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("allocateQuestions", () => {
  it("returns {} for empty eligibleLectures", () => {
    expect(
      allocateQuestions({
        eligibleLectures: [],
        requestedCount: 10,
        weakConcepts: {},
        blockId: BLOCK_ID,
        sessionId: "s1",
      })
    ).toEqual({});
  });

  it("returns {} for requestedCount 0", () => {
    expect(
      allocateQuestions({
        eligibleLectures: [{ lectureId: "lec-1", objectiveCount: 3 }],
        requestedCount: 0,
        weakConcepts: {},
        blockId: BLOCK_ID,
        sessionId: "s1",
      })
    ).toEqual({});
  });

  it("guarantees minimum coverage: every eligible lecture gets >= 1 when requestedCount >= lecture count", () => {
    const eligibleLectures = [
      { lectureId: "lec-a", objectiveCount: 2 },
      { lectureId: "lec-b", objectiveCount: 10 },
      { lectureId: "lec-c", objectiveCount: 5 },
    ];
    const weakConcepts = {
      [BLOCK_ID]: [
        { concept: "x", masteryLevel: "struggling", linkedLecIds: ["lec-b"] },
        { concept: "y", masteryLevel: "struggling", linkedLecIds: ["lec-b"] },
      ],
    };
    const counts = allocateQuestions({
      eligibleLectures,
      requestedCount: 6,
      weakConcepts,
      blockId: BLOCK_ID,
      sessionId: "seed-min-cov",
    });
    for (const lec of eligibleLectures) {
      expect(counts[lec.lectureId]).toBeGreaterThanOrEqual(1);
    }
    expect(sumCounts(counts)).toBe(6);
  });

  it("weighted sampling favors the higher-severity/higher-objective-count lecture for remaining slots (exact, fixed seed)", () => {
    // lec-hi: max severity (5+ non-mastered weak concepts) and max objective
    // count -> weight = 1*0.6 + 1*0.4 = 1.0
    // lec-lo: no weak concepts, minimal objective count -> weight = 0*0.6 + (1/20)*0.4 = 0.02
    const eligibleLectures = [
      { lectureId: "lec-hi", objectiveCount: 20 },
      { lectureId: "lec-lo", objectiveCount: 1 },
    ];
    const weakConcepts = {
      [BLOCK_ID]: [
        { concept: "c1", masteryLevel: "struggling", linkedLecIds: ["lec-hi"] },
        { concept: "c2", masteryLevel: "struggling", linkedLecIds: ["lec-hi"] },
        { concept: "c3", masteryLevel: "struggling", linkedLecIds: ["lec-hi"] },
        { concept: "c4", masteryLevel: "struggling", linkedLecIds: ["lec-hi"] },
        { concept: "c5", masteryLevel: "struggling", linkedLecIds: ["lec-hi"] },
      ],
    };
    const counts = allocateQuestions({
      eligibleLectures,
      requestedCount: 100,
      weakConcepts,
      blockId: BLOCK_ID,
      sessionId: "seed-weighted-fav",
    });
    expect(sumCounts(counts)).toBe(100);
    expect(counts["lec-hi"]).toBeGreaterThan(counts["lec-lo"]);
    // Exact values for this fixed seed — locks in determinism, not just direction.
    expect(counts).toEqual({ "lec-hi": 83, "lec-lo": 17 });
  });

  it("below-minimum-coverage: selects exactly requestedCount distinct lectures, none repeated", () => {
    const eligibleLectures = [
      { lectureId: "lec-1", objectiveCount: 3 },
      { lectureId: "lec-2", objectiveCount: 8 },
      { lectureId: "lec-3", objectiveCount: 1 },
      { lectureId: "lec-4", objectiveCount: 6 },
      { lectureId: "lec-5", objectiveCount: 2 },
    ];
    const counts = allocateQuestions({
      eligibleLectures,
      requestedCount: 2,
      weakConcepts: {},
      blockId: BLOCK_ID,
      sessionId: "seed-below-min",
    });
    const entries = Object.entries(counts);
    expect(entries.length).toBe(2);
    for (const [, count] of entries) {
      expect(count).toBe(1);
    }
    expect(sumCounts(counts)).toBe(2);
  });

  it("determinism: identical inputs (including same sessionId) produce byte-identical output across two calls", () => {
    const eligibleLectures = [
      { lectureId: "lec-a", objectiveCount: 4 },
      { lectureId: "lec-b", objectiveCount: 9 },
      { lectureId: "lec-c", objectiveCount: 2 },
    ];
    const weakConcepts = {
      [BLOCK_ID]: [{ concept: "c1", masteryLevel: "struggling", linkedLecIds: ["lec-b"] }],
    };
    const args = {
      eligibleLectures,
      requestedCount: 15,
      weakConcepts,
      blockId: BLOCK_ID,
      sessionId: "same-session-id",
    };
    const first = allocateQuestions(args);
    const second = allocateQuestions({ ...args, eligibleLectures: [...eligibleLectures] });
    expect(second).toEqual(first);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it("different sessionId is allowed (not required) to differ", () => {
    const eligibleLectures = [
      { lectureId: "lec-a", objectiveCount: 4 },
      { lectureId: "lec-b", objectiveCount: 9 },
      { lectureId: "lec-c", objectiveCount: 2 },
    ];
    const args = {
      eligibleLectures,
      requestedCount: 15,
      weakConcepts: {},
      blockId: BLOCK_ID,
    };
    const a = allocateQuestions({ ...args, sessionId: "session-one" });
    const b = allocateQuestions({ ...args, sessionId: "session-two" });
    // Both are valid full allocations regardless of whether they match.
    expect(sumCounts(a)).toBe(15);
    expect(sumCounts(b)).toBe(15);
  });

  it("zero-objective-count lecture doesn't crash and normalizes to 0, not NaN/Infinity", () => {
    const eligibleLectures = [
      { lectureId: "lec-zero", objectiveCount: 0 },
      { lectureId: "lec-normal", objectiveCount: 5 },
    ];
    const counts = allocateQuestions({
      eligibleLectures,
      requestedCount: 10,
      weakConcepts: {},
      blockId: BLOCK_ID,
      sessionId: "seed-zero-obj",
    });
    expect(sumCounts(counts)).toBe(10);
    for (const v of Object.values(counts)) {
      expect(Number.isFinite(v)).toBe(true);
      expect(Number.isNaN(v)).toBe(false);
    }
    expect(counts["lec-zero"]).toBeGreaterThanOrEqual(1);
  });

  it("all-zero-weight lectures (all zero objectiveCount, no weak concepts) still allocate without NaN", () => {
    const eligibleLectures = [
      { lectureId: "lec-a", objectiveCount: 0 },
      { lectureId: "lec-b", objectiveCount: 0 },
    ];
    const counts = allocateQuestions({
      eligibleLectures,
      requestedCount: 8,
      weakConcepts: {},
      blockId: BLOCK_ID,
      sessionId: "seed-all-zero",
    });
    expect(sumCounts(counts)).toBe(8);
    for (const v of Object.values(counts)) {
      expect(Number.isFinite(v)).toBe(true);
    }
  });

  it("tie-break determinism: identical-weight lectures produce a stable, repeatable pick under lexical iteration order", () => {
    // Both lectures have identical objectiveCount and no weak concepts -> identical weight (0).
    const eligibleLectures = [
      { lectureId: "lec-z", objectiveCount: 4 },
      { lectureId: "lec-a", objectiveCount: 4 },
    ];
    const args = {
      eligibleLectures,
      requestedCount: 1,
      weakConcepts: {},
      blockId: BLOCK_ID,
      sessionId: "seed-tie-break",
    };
    const first = allocateQuestions(args);
    const second = allocateQuestions({ ...args, eligibleLectures: [...eligibleLectures] });
    expect(second).toEqual(first);
    // Exactly one distinct lecture picked (below-minimum-coverage: requestedCount 1 < 2 lectures).
    expect(Object.keys(first).length).toBe(1);
  });
});
