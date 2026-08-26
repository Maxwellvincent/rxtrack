import { describe, expect, it } from "vitest";
import { impactFor } from "./mentalModelImpact.js";

const attempt = (at, correct, difficulty = "medium", responseMs = 60000) => ({ at, correct, difficulty, responseMs });

describe("mental model impact", () => {
  it("separates baseline, post-model, transfer and delayed attempts", () => {
    const day = 86400000;
    const entry = {
      reviewedAt: 1000,
      attempts: [
        attempt(500, false), attempt(600, true),
        attempt(2000, true, "expert", 45000),
        attempt(1000 + day + 1, true, "hard", 40000),
      ],
    };
    const result = impactFor(entry, 1000 + day * 2);
    expect(result.baseline.count).toBe(2);
    expect(result.post.count).toBe(2);
    expect(result.transfer.count).toBe(2);
    expect(result.delayed24h.count).toBe(1);
  });

  it("uses the captured cumulative baseline when no granular old attempts exist", () => {
    const result = impactFor({ reviewedAt: 1000, baseline: { answered: 10, correct: 6 }, attempts: [] });
    expect(result.baseline).toMatchObject({ count: 10, correct: 6, accuracy: 0.6 });
  });

  it("excludes repeated question stems from post-model evidence", () => {
    const entry = {
      reviewedAt: 1000,
      attempts: [
        { ...attempt(500, false), stem: "same question" },
        { ...attempt(2000, true), stem: "same question" },
        { ...attempt(3000, true), stem: "new question" },
      ],
    };
    expect(impactFor(entry).post.count).toBe(1);
  });

  it("calls the habit working only with enough evidence and a meaningful gain", () => {
    const before = Array.from({ length: 10 }, (_, i) => attempt(i, i < 6, "medium", 60000));
    const after = Array.from({ length: 10 }, (_, i) => attempt(2000 + i, i < 8, "expert", 50000));
    expect(impactFor({ reviewedAt: 1000, attempts: [...before, ...after] }).state).toBe("working");
  });
});
