import { describe, expect, it } from "vitest";
import { lectureReviewDays, reviewLabel, objectiveLectureMap, REVIEW_TARGET } from "./lectureReviewDays.js";

const at = (day, hour = 10) => new Date(2026, 10, day, hour).getTime();
const answers = (lectureId, day, count, extra = {}) => Array.from({ length: count }, (_, i) => ({ lectureId, at: at(day, 9 + (i % 8)), objectiveIds: [], ...extra }));

describe("lectureReviewDays", () => {
  it("counts one review per day with at least five answers", () => {
    const journal = [...answers("L", 10, 6), ...answers("L", 10, 4), ...answers("L", 12, 5), ...answers("L", 14, 3)];
    expect(lectureReviewDays(journal).L).toEqual({ reviews: 2, days: ["2026-11-10", "2026-11-12"], lastReview: "2026-11-12" });
  });

  it("lowers the threshold for lectures with few objectives", () => {
    expect(lectureReviewDays(answers("L", 14, 3), { objectiveCounts: { L: 3 } }).L.reviews).toBe(1);
  });

  it("attributes events without a lecture id through their objectives", () => {
    const journal = answers(null, 15, 5, { objectiveIds: ["o1"] });
    expect(lectureReviewDays(journal, { objectiveLecture: objectiveLectureMap([{ id: "o1", linkedLecId: "L" }]) }).L.reviews).toBe(1);
  });

  it("labels progress toward the target", () => {
    expect(reviewLabel(null)).toBe("");
    expect(reviewLabel({ reviews: 2 })).toBe(`2/${REVIEW_TARGET} reviews`);
    expect(reviewLabel({ reviews: REVIEW_TARGET })).toBe(`✓ ${REVIEW_TARGET} reviews`);
  });
});
