import { describe, expect, it } from "vitest";
import { workAheadLectures } from "./workAhead.js";

/** A lecScore as generateDailySchedule emits it, trimmed to what workAhead reads. */
const score = (id, availableDate, extra = {}) => ({
  lec: { id, lectureTitle: id, lectureDate: availableDate },
  availableDate: availableDate ? new Date(`${availableDate}T00:00:00`) : null,
  isFuture: true,
  struggling: 0,
  nextReview: null,
  ...extra,
});

const NOW = new Date("2026-08-16T09:00:00");

describe("workAheadLectures", () => {
  it("offers only lectures dated inside the horizon", () => {
    const daily = {
      lecScores: [
        score("tomorrow", "2026-08-17"),
        score("in-two-days", "2026-08-18"),
        score("in-five-days", "2026-08-21"),
      ],
      daysLeft: 30,
    };

    const result = workAheadLectures(daily, { now: NOW, examDate: "2026-09-15" });

    expect(result.lectures.map((ls) => ls.lec.id)).toEqual(["tomorrow", "in-two-days"]);
  });

  it("hides itself inside the last week before the block exam", () => {
    const daily = { lecScores: [score("tomorrow", "2026-08-17")], daysLeft: 5 };

    // Exam on Aug 21 — five days out, deep in the crunch zone.
    const result = workAheadLectures(daily, { now: NOW, examDate: "2026-08-21" });

    expect(result.hidden).toBe(true);
    // Still returned, because the section can be expanded by hand.
    expect(result.lectures.map((ls) => ls.lec.id)).toEqual(["tomorrow"]);
  });

  it("opens on its own only when nothing is struggling and no review is overdue", () => {
    const caughtUp = {
      lecScores: [
        score("tomorrow", "2026-08-17"),
        score("past", "2026-08-10", { isFuture: false, struggling: 0, nextReview: null }),
      ],
      daysLeft: 30,
    };
    expect(workAheadLectures(caughtUp, { now: NOW, examDate: "2026-09-15" }).expanded).toBe(true);

    const behind = {
      lecScores: [
        score("tomorrow", "2026-08-17"),
        score("weak", "2026-08-10", { isFuture: false, struggling: 2 }),
      ],
      daysLeft: 30,
    };
    expect(workAheadLectures(behind, { now: NOW, examDate: "2026-09-15" }).expanded).toBe(false);

    const overdue = {
      lecScores: [
        score("tomorrow", "2026-08-17"),
        score("stale", "2026-08-10", {
          isFuture: false,
          nextReview: new Date("2026-08-14T00:00:00"),
        }),
      ],
      daysLeft: 30,
    };
    expect(workAheadLectures(overdue, { now: NOW, examDate: "2026-09-15" }).expanded).toBe(false);
  });

  it("never offers an undated lecture", () => {
    const daily = { lecScores: [score("no-date", null)], daysLeft: 30 };
    expect(workAheadLectures(daily, { now: NOW }).lectures).toEqual([]);
  });
});
