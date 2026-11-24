import { describe, expect, it } from "vitest";
import { examAwareReviewDays, capIntervalForExam, examGapCap } from "./examSpacing.js";

const day = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };

describe("examGapCap", () => {
  it("shrinks the longest gap as the exam approaches", () => {
    expect(examGapCap(7)).toBe(2);
    expect(examGapCap(14)).toBe(4);
    expect(examGapCap(30)).toBe(10);
    expect(examGapCap(2)).toBe(1);
  });
});

describe("capIntervalForExam", () => {
  it("never lets a 7-day review land on or after the exam", () => {
    const now = day("2026-11-24").getTime();
    const capped = capIntervalForExam(7, now, "2026-12-01");
    expect(capped).toBeLessThanOrEqual(2);
  });
  it("leaves intervals alone without an exam or after it", () => {
    const now = day("2026-11-24").getTime();
    expect(capIntervalForExam(7, now, null)).toBe(7);
    expect(capIntervalForExam(7, now, "2026-11-20")).toBe(7);
  });
  it("keeps the review on or before the day before the exam", () => {
    const now = day("2026-11-29").getTime();
    expect(capIntervalForExam(3, now, "2026-12-01")).toBe(1);
  });
});

describe("examAwareReviewDays", () => {
  const keys = (dates) => dates.map((d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
  it("reviews a lecture every 1-2 days in the final week and the day before the exam", () => {
    const dates = keys(examAwareReviewDays(day("2026-11-24"), "okay", "2026-12-01"));
    expect(dates[0]).toBe("2026-11-25");
    expect(dates.at(-1)).toBe("2026-11-30");
    expect(dates.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < dates.length; i++) expect((day(dates[i]) - day(dates[i - 1])) / 86400000).toBeLessThanOrEqual(2);
  });
  it("spaces wider when the exam is a month out but still ends the day before", () => {
    const dates = keys(examAwareReviewDays(day("2026-11-01"), "good", "2026-12-01"));
    expect(dates[0]).toBe("2026-11-03");
    expect(dates.at(-1)).toBe("2026-11-30");
    for (let i = 1; i < dates.length; i++) expect((day(dates[i]) - day(dates[i - 1])) / 86400000).toBeLessThanOrEqual(10);
  });
  it("returns nothing when the exam is today or past", () => {
    expect(examAwareReviewDays(day("2026-12-01"), "okay", "2026-12-01")).toEqual([]);
  });
});

import { gradeModel, selectDailyModels, DAY } from "./modelRetrieval.js";
import { lectureReviewTiming } from "../shell/features/objectives/lectureReviewTiming.js";

describe("exam-aware lecture reviews", () => {
  const now = day("2026-11-24").getTime() + 12 * 3600000;
  const model = { id: "m", blockId: "b", status: "Learning", solidStreak: 0, minutes: 3, createdAt: 0, history: [], lastReviewedAt: null, nextReviewAt: now };

  it("a solid slides review a week before the exam comes back within two days, not on exam day", () => {
    const graded = gradeModel(model, "solid", now, "e1", "2026-12-01");
    expect((graded.nextReviewAt - now) / DAY).toBeLessThanOrEqual(2);
    expect(gradeModel(model, "solid", now, "e1", null).nextReviewAt - now).toBe(7 * DAY);
  });

  it("pulls a stored post-exam review date forward so it is due before the exam", () => {
    const stored = { ...model, lastReviewedAt: now - 3 * DAY, nextReviewAt: now + 4 * DAY };
    expect(selectDailyModels([stored], {}, now, "b", null).selected).toHaveLength(0);
    expect(selectDailyModels([stored], {}, now, "b", "2026-12-01").selected).toHaveLength(1);
  });

  it("lecture timing uses the exam date instead of a stale 30-day review", () => {
    const row = { lec: { id: "l" }, st: 0, m: 1, total: 1 };
    const completion = { "l__b": { lastActivityDate: "2026-11-23", reviewDates: ["2026-12-23"], activityLog: [{ activityType: "review", date: "2026-11-23" }] } };
    const timing = lectureReviewTiming(row, "b", completion, {}, null, now, { examDate: "2026-12-01" });
    expect(timing.nextReview <= "2026-11-25").toBe(true);
  });
});
