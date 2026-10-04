import { describe, expect, it } from "vitest";
import { buildTeachingBlocks, lectureModelFromBlocks } from "./lectureTutorPlan.js";

describe("lecture teaching plans", () => {
  it("groups related objectives into a visible first-pass plan", () => {
    const blocks = buildTeachingBlocks([
      { id: "o1", objective: "Explain gray and white matter" },
      { id: "o2", objective: "Compare gray matter processing and white matter tracts" },
      { id: "o3", objective: "Localize motor lesions" },
    ], []);
    expect(blocks.length).toBeLessThan(3);
    expect(blocks[0].objectiveIds).toContain("o1");
    expect(lectureModelFromBlocks(blocks, "neuroanatomy")).toContain("teaching blocks");
  });

  it("keeps an objective without source atoms usable", () => {
    const blocks = buildTeachingBlocks([{ id: "o1", objective: "Describe the ventricular system" }], []);
    expect(blocks[0]).toMatchObject({ objectiveIds: ["o1"], sourceAtomIds: [], status: "teaching", phase: "orient" });
  });
});
