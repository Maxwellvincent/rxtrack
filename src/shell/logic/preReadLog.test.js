import { describe, expect, it } from "vitest";
import { appendActivity } from "./completionLog.js";
import { appendPreRead, PRE_READ_ACTIVITY } from "./preReadLog.js";

const ARGS = {
  lectureId: "lec1",
  blockId: "blk1",
  examDate: "2026-09-15",
  now: new Date("2026-08-16T09:00:00"),
  gapObjectiveIds: ["obj2", "obj5"],
};

describe("appendPreRead", () => {
  it("records the pre-read without scheduling a review or counting a session", () => {
    // A normal activity plants review dates and counts a rep — that is what a
    // pre-read must NOT do. `lectureUrgency` adds +20 when nextReview <= today,
    // so a pre-read on unseen material would rocket the lecture up Today.
    const normal = appendActivity({}, { ...ARGS, activityType: "quiz", confidenceRating: "struggling" });
    expect(normal.entry.reviewDates.length).toBeGreaterThan(0);
    expect(normal.entry.sessionCount).toBe(1);

    const { entry } = appendPreRead({}, ARGS);

    expect(entry.reviewDates).toEqual([]);
    expect(entry.sessionCount).toBe(0);
    expect(entry.activityLog[0].activityType).toBe(PRE_READ_ACTIVITY);
  });

  it("keeps the review schedule an earlier real session already earned", () => {
    const studied = appendActivity({}, { ...ARGS, activityType: "quiz", confidenceRating: "good" });

    const { entry } = appendPreRead(studied.store, ARGS);

    expect(entry.reviewDates).toEqual(studied.entry.reviewDates);
    expect(entry.sessionCount).toBe(1);
    expect(entry.activityLog).toHaveLength(2);
  });

  it("carries the gap objectives so lecture day can open on them", () => {
    const { entry } = appendPreRead({}, ARGS);
    expect(entry.preRead.gapObjectiveIds).toEqual(["obj2", "obj5"]);
    expect(entry.preRead.date).toBe("2026-08-16");
  });
});
