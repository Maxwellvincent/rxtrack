import { describe, it, expect } from "vitest";
import { levelFromConsecutive, modeForLevel, recordOutcome } from "./mastery.js";

describe("levelFromConsecutive", () => {
  it("maps streak to level", () => {
    expect(levelFromConsecutive(0)).toBe("struggling");
    expect(levelFromConsecutive(1)).toBe("struggling");
    expect(levelFromConsecutive(2)).toBe("developing");
    expect(levelFromConsecutive(3)).toBe("developing");
    expect(levelFromConsecutive(4)).toBe("mastered");
  });
});

describe("modeForLevel", () => {
  it("maps level to mode", () => {
    expect(modeForLevel("struggling")).toBe("teach");
    expect(modeForLevel("developing")).toBe("recognize");
    expect(modeForLevel("mastered")).toBe("test");
    expect(modeForLevel("???")).toBe("teach");
  });
});

describe("recordOutcome", () => {
  const base = { concept: "preload", consecutiveCorrect: 1, missCount: 0, totalAttempts: 1, masteryLevel: "struggling" };
  it("correct advances streak + level", () => {
    const c = recordOutcome(base, "correct");
    expect(c.consecutiveCorrect).toBe(2);
    expect(c.masteryLevel).toBe("developing");
    expect(c.totalAttempts).toBe(2);
  });
  it("wrong resets streak + bumps missCount", () => {
    const c = recordOutcome({ ...base, consecutiveCorrect: 3 }, "wrong");
    expect(c.consecutiveCorrect).toBe(0);
    expect(c.missCount).toBe(1);
    expect(c.masteryLevel).toBe("struggling");
  });
  it("exposure leaves streak, bumps attempts", () => {
    const c = recordOutcome(base, "exposure");
    expect(c.consecutiveCorrect).toBe(1);
    expect(c.totalAttempts).toBe(2);
  });
});
