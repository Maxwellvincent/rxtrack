import { describe, it, expect } from "vitest";
import { planCalibrationBackfill } from "./backfillCalibration.js";

const entry = (over = {}) => ({
  date: "2026-03-04T10:00:00.000Z",
  predicted: 90,
  correct: true,
  source: "deeplearn",
  blockId: "b1",
  objectiveId: "o1",
  lectureId: "l1",
  ...over,
});

describe("planCalibrationBackfill", () => {
  it("converts a percent entry onto the 1-5 scale, keyed by its block", () => {
    const plan = planCalibrationBackfill([entry()], {});
    expect(plan.byBlock.b1[0]).toMatchObject({
      confidence: 5,
      correct: true,
      source: "deeplearn-backfill",
      ts: Date.parse("2026-03-04T10:00:00.000Z"),
    });
  });

  it("preserves the confident boundary — 90 is a landmine, 70 is not", () => {
    const plan = planCalibrationBackfill([entry({ predicted: 90 }), entry({ predicted: 70 })], {});
    expect(plan.byBlock.b1.map((r) => r.confidence)).toEqual([5, 3]);
  });

  it("names the concept from the objective when one can be resolved", () => {
    const plan = planCalibrationBackfill([entry()], { resolveConcept: (id) => (id === "o1" ? "Cortisol synthesis" : null) });
    expect(plan.byBlock.b1[0].concept).toBe("Cortisol synthesis");
  });

  it("falls back to a label that says what it is, rather than inventing one", () => {
    const plan = planCalibrationBackfill([entry({ objectiveId: null })], {});
    expect(plan.byBlock.b1[0].concept).toMatch(/Deep Learn/);
  });

  it("buckets entries with no block so they are still counted", () => {
    const plan = planCalibrationBackfill([entry({ blockId: null })], {});
    expect(Object.keys(plan.byBlock)).toEqual(["deeplearn"]);
  });

  it("skips entries with an unusable date — a record with no time cannot be deduped", () => {
    const plan = planCalibrationBackfill([entry({ date: "not a date" }), entry()], {});
    expect(plan.byBlock.b1).toHaveLength(1);
    expect(plan.skipped).toBe(1);
  });

  it("skips entries whose predicted value was never a real bucket", () => {
    const plan = planCalibrationBackfill([entry({ predicted: null }), entry()], {});
    expect(plan.skipped).toBe(1);
  });

  it("counts what it will write so a dry run can be read", () => {
    const plan = planCalibrationBackfill([entry(), entry({ blockId: "b2" })], {});
    expect(plan.total).toBe(2);
    expect(plan.blocks).toBe(2);
  });

  it("is stable across runs — same input, same timestamps, so a merge dedupes it", () => {
    const a = planCalibrationBackfill([entry()], {});
    const b = planCalibrationBackfill([entry()], {});
    expect(a.byBlock.b1[0].ts).toBe(b.byBlock.b1[0].ts);
    expect(a.byBlock.b1[0].concept).toBe(b.byBlock.b1[0].concept);
  });

  it("handles an empty or missing log", () => {
    expect(planCalibrationBackfill([], {}).total).toBe(0);
    expect(planCalibrationBackfill(null, {}).total).toBe(0);
  });
});
