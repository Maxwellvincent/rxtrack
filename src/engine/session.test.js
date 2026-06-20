import { describe, it, expect } from "vitest";
import { createSession, advanceSession, sessionSummary } from "./session.js";

describe("session reducer", () => {
  it("creates an empty burst", () => {
    expect(createSession(3)).toEqual({ size: 3, index: 0, results: [], done: false });
  });
  it("advances and completes at size", () => {
    let s = createSession(2);
    s = advanceSession(s, { concept: "a", mode: "teach", outcome: "exposure" });
    expect(s.index).toBe(1);
    expect(s.done).toBe(false);
    s = advanceSession(s, { concept: "b", mode: "test", outcome: "correct" });
    expect(s.index).toBe(2);
    expect(s.done).toBe(true);
  });
  it("summarizes outcomes", () => {
    let s = createSession(3);
    s = advanceSession(s, { concept: "a", mode: "recognize", outcome: "correct", becameMastered: true });
    s = advanceSession(s, { concept: "b", mode: "test", outcome: "wrong" });
    s = advanceSession(s, { concept: "c", mode: "teach", outcome: "exposure" });
    expect(sessionSummary(s)).toEqual({ total: 3, correct: 1, wrong: 1, exposures: 1, masteredGained: 1 });
  });
});
