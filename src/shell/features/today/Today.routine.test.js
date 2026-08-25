import { describe, expect, it } from "vitest";
import { computeSchedule } from "./Today.jsx";

describe("optimized daily routine", () => {
  it("keeps 06:30 as the travel anchor when wake time moves later", () => {
    const blocks = computeSchedule("lecture", "06:00", "08:00", 60, {
      leaveHomeTime: "06:30", smallGroup: true, gymTime: "21:00",
    });
    expect(blocks.find((block) => block.label.includes("Travel to school"))).toMatchObject({ start: 390, end: 405 });
    expect(blocks.find((block) => block.label.includes("Anki — retention"))).toBeUndefined();
  });

  it("uses the no-small-group afternoon when selected", () => {
    const blocks = computeSchedule("lecture", "05:30", "08:00", 60, {
      leaveHomeTime: "06:30", smallGroup: false, gymTime: "21:00",
    });
    expect(blocks.some((block) => block.label.includes("Small group"))).toBe(false);
    expect(blocks.some((block) => block.label.includes("Additional questions"))).toBe(true);
  });

  it("organizes the routine into the learning sequence", () => {
    const phases = new Set(computeSchedule("lecture", "05:00", "08:00", 60, {
      leaveHomeTime: "06:30", smallGroup: true, gymTime: "21:00",
    }).map((block) => block.phase));
    for (const phase of ["RETAIN", "EXPOSE", "BUILD", "RETRIEVE", "APPLY", "REPAIR", "REMEDIATE", "PREPARE"]) {
      expect(phases.has(phase)).toBe(true);
    }
  });
});
