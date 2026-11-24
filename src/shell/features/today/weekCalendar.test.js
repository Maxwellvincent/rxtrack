import { describe, expect, it } from "vitest";
import { buildWeekCalendar, weekStart } from "./weekCalendar.js";

const local = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const now = local("2026-11-25").getTime() + 9 * 3600000; // Wednesday

describe("buildWeekCalendar", () => {
  const lecScores = [
    { lec: { id: "a", lectureTitle: "Brainstem", lectureNumber: 59, lectureType: "Lec" }, availableDate: local("2026-11-23") },
    { lec: { id: "b", lectureTitle: "Cerebellum", lectureNumber: 60 }, availableDate: local("2026-11-23") },
    { lec: { id: "c", lectureTitle: "Thalamus", lectureNumber: 61 }, availableDate: local("2026-11-18") },
  ];
  const completion = { "c__blk": { lastActivityDate: "2026-11-24", lastConfidence: "okay", reviewDates: ["2026-12-24"] } };

  it("starts weeks on Monday and places lectures on the day they were given", () => {
    expect(weekStart(now).getDay()).toBe(1);
    const cal = buildWeekCalendar({ lecScores, completion, blockId: "blk", now, examDate: "2026-12-01" });
    expect(cal.days[0].given.map((row) => row.number)).toEqual([59, 60]);
    expect(cal.days[2].isToday).toBe(true);
  });

  it("shows exam-aware reviews on upcoming days, not the stale stored date", () => {
    const cal = buildWeekCalendar({ lecScores, completion, blockId: "blk", now, examDate: "2026-12-01" });
    const reviewDays = cal.days.filter((d) => d.reviews.some((row) => row.id === "c")).map((d) => d.key);
    expect(reviewDays).toContain("2026-11-25");
    expect(reviewDays.length).toBeGreaterThanOrEqual(2);
  });

  it("navigates to the previous week and marks the exam day", () => {
    const prev = buildWeekCalendar({ lecScores, completion, blockId: "blk", now, weekOffset: -1, examDate: "2026-12-01" });
    expect(prev.days[2].given.map((row) => row.id)).toEqual(["c"]);
    const next = buildWeekCalendar({ lecScores, completion, blockId: "blk", now, weekOffset: 1, examDate: "2026-12-01" });
    expect(next.days[1].isExam).toBe(true);
  });
});
