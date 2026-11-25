import { describe, expect, it } from "vitest";
import { projectedScore } from "./projectedScore.js";

describe("projectedScore", () => {
  const objectives = [{ id: "a", objective: "A", _schoolEmphasis: 3 }, { id: "b", objective: "B" }, { id: "c", objective: "C" }];
  it("weights accuracy by school emphasis and ranks the biggest gains", () => {
    const evidence = { objectives: { a: { attempts: 8, correct: 2, recent: [false] }, b: { attempts: 8, correct: 8, recent: [true] } } };
    const result = projectedScore(objectives, evidence);
    expect(result.answered).toBe(2);
    expect(result.score).toBeLessThan(0.5); // the heavily tested objective is weak
    expect(result.topGains[0].id).toBe("a");
    expect(result.topGains.map((row) => row.id)).not.toContain("b");
  });
  it("counts unanswered objectives as 50% and returns null with no objectives", () => {
    expect(projectedScore([{ id: "x" }], {}).score).toBe(0.5);
    expect(projectedScore([], {})).toBeNull();
  });
});
