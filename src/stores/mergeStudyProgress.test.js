import { describe, it, expect } from "vitest";
import { mergeRoundProgress, mergeCalibration, mergeQuestionStats } from "./merge.js";

describe("mergeRoundProgress", () => {
  it("keeps the furthest round reached on either device", () => {
    const out = mergeRoundProgress({ lec1: { round: 2, at: 10 } }, { lec1: { round: 5, at: 20 } });
    expect(out.lec1.round).toBe(5);
  });

  it("does not let a device that fell behind pull progress backwards", () => {
    const out = mergeRoundProgress({ lec1: { round: 7, at: 30 } }, { lec1: { round: 3, at: 99 } });
    expect(out.lec1.round).toBe(7);
  });

  it("carries lectures that only one side has ever studied", () => {
    const out = mergeRoundProgress({ lec1: { round: 1, at: 1 } }, { lec2: { round: 4, at: 2 } });
    expect(out).toEqual({ lec1: { round: 1, at: 1 }, lec2: { round: 4, at: 2 } });
  });

  it("keeps the timestamp of the round that won", () => {
    const out = mergeRoundProgress({ lec1: { round: 2, at: 10 } }, { lec1: { round: 6, at: 44 } });
    expect(out.lec1.at).toBe(44);
  });

  it("survives missing or malformed sides", () => {
    expect(mergeRoundProgress(null, { lec1: { round: 3 } }).lec1.round).toBe(3);
    expect(mergeRoundProgress({ lec1: { round: 3 } }, null).lec1.round).toBe(3);
    expect(mergeRoundProgress({ lec1: "nonsense" }, {})).toEqual({});
  });
});

describe("mergeCalibration", () => {
  const rec = (ts, concept, correct = true) => ({ ts, concept, confidence: 4, correct });

  it("unions the answers from both devices, oldest first", () => {
    const out = mergeCalibration({ b1: [rec(2, "a")] }, { b1: [rec(1, "b")] });
    expect(out.b1.map((r) => r.ts)).toEqual([1, 2]);
  });

  it("does not double-count an answer both sides already have", () => {
    const out = mergeCalibration({ b1: [rec(5, "colloid")] }, { b1: [rec(5, "colloid")] });
    expect(out.b1).toHaveLength(1);
  });

  it("keeps two answers to the same concept at different times — that is a retest", () => {
    const out = mergeCalibration({ b1: [rec(5, "colloid")] }, { b1: [rec(9, "colloid")] });
    expect(out.b1).toHaveLength(2);
  });

  it("carries blocks only one side has", () => {
    const out = mergeCalibration({ b1: [rec(1, "a")] }, { b2: [rec(1, "c")] });
    expect(Object.keys(out).sort()).toEqual(["b1", "b2"]);
  });

  it("drops junk records rather than poisoning the accuracy curve", () => {
    const out = mergeCalibration({ b1: [rec(1, "a"), null, { ts: 2 }] }, {});
    expect(out.b1).toHaveLength(1);
  });

  it("survives missing sides", () => {
    expect(mergeCalibration(null, { b1: [rec(1, "a")] }).b1).toHaveLength(1);
    expect(mergeCalibration({ b1: [rec(1, "a")] }, null).b1).toHaveLength(1);
  });
});

describe("mergeQuestionStats", () => {
  it("keeps the device that has answered more", () => {
    const out = mergeQuestionStats(
      { lec1: { answered: 10, correct: 6, at: 1 } },
      { lec1: { answered: 25, correct: 20, at: 2 } }
    );
    expect(out.lec1).toMatchObject({ answered: 25, correct: 20 });
  });

  it("does not let a device that fell behind pull the count backwards", () => {
    const out = mergeQuestionStats(
      { lec1: { answered: 40, correct: 30, at: 1 } },
      { lec1: { answered: 5, correct: 5, at: 99 } }
    );
    expect(out.lec1.answered).toBe(40);
    expect(out.lec1.correct).toBe(30);
  });

  it("takes answered and correct from the same side, never a mix", () => {
    const out = mergeQuestionStats(
      { lec1: { answered: 8, correct: 8, at: 1 } },
      { lec1: { answered: 20, correct: 12, at: 2 } }
    );
    expect(out.lec1.correct).toBeLessThanOrEqual(out.lec1.answered);
    expect(out.lec1.correct).toBe(12);
  });

  it("clamps a correct count that exceeds the answered count", () => {
    expect(mergeQuestionStats({ lec1: { answered: 3, correct: 9 } }, {}).lec1.correct).toBe(3);
  });

  it("keeps lectures only one side has seen", () => {
    const out = mergeQuestionStats({ lec1: { answered: 2, correct: 1 } }, { lec2: { answered: 4, correct: 4 } });
    expect(Object.keys(out).sort()).toEqual(["lec1", "lec2"]);
  });

  it("tolerates garbage", () => {
    expect(mergeQuestionStats(null, { lec1: { answered: 3, correct: 1 } }).lec1.answered).toBe(3);
    expect(mergeQuestionStats({ lec1: "nonsense" }, {})).toEqual({});
    expect(mergeQuestionStats({ lec1: { answered: 0 } }, {})).toEqual({});
  });
});
