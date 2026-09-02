import { beforeEach, describe, expect, it } from "vitest";
import { installDomStorage } from "../../../stores/testEnv.js";
import { detectStudyMode, hasUploadedContent } from "../../logic/studyMode.js";
import { appendActivity, computeReviewDates, getNextSaturday, localDateString } from "../../logic/completionLog.js";
import { buildScheduleContext, resolveBlockMeta, lecturePerformanceFor } from "./scheduleContext.js";
import { catchUpTasks, todayTasks } from "./fallback.js";
import { generateDailySchedule, buildStudySchedule } from "../../logic/schedule.js";

describe("detectStudyMode", () => {
  it("routes by lecture title", () => {
    expect(detectStudyMode({ lectureTitle: "Histology of Cartilage" }).mode).toBe("histology");
    expect(detectStudyMode({ lectureTitle: "Brachial Plexus Anatomy" }).mode).toBe("anatomy");
    expect(detectStudyMode({ lectureTitle: "Beta blockers and receptor agonists" }).mode).toBe("pharmacology");
    expect(detectStudyMode({ lectureTitle: "Glycolysis and the Krebs cycle" }).mode).toBe("biochemistry");
    expect(detectStudyMode({ lectureTitle: "Renal filtration and flow" }).mode).toBe("physiology");
    expect(detectStudyMode({ lectureTitle: "Necrosis and infarct patterns" }).mode).toBe("pathology");
    expect(detectStudyMode({ lectureTitle: "Interviewing skills" }).mode).toBe("clinical");
  });

  it("reads the objectives too, not just the title", () => {
    expect(
      detectStudyMode({ lectureTitle: "Week 3" }, [{ objective: "Describe the epithelial tissue slide" }]).mode
    ).toBe("histology");
  });

  it("prefers histology when a lecture reads as both", () => {
    expect(detectStudyMode({ lectureTitle: "Histology of bone and muscle" }).mode).toBe("histology");
  });

  it("reports whether there is enough text to study from", () => {
    expect(hasUploadedContent({ chunks: [{ markdown: "x".repeat(201) }] })).toBe(true);
    expect(hasUploadedContent({ chunks: [{ markdown: "short" }] })).toBe(false);
    expect(hasUploadedContent(null)).toBe(false);
  });
});

describe("completion logging", () => {
  it("uses the local calendar day for late-evening completion logs", () => {
    const lateLocal = new Date(2026, 7, 24, 23, 30, 0);
    expect(localDateString(lateLocal)).toBe("2026-08-24");
    const logged = appendActivity({}, { lectureId: "l", blockId: "b", now: lateLocal });
    expect(logged.entry.lastActivityDate).toBe("2026-08-24");
  });

  it("spaces the first review by confidence, on the right calendar day", () => {
    // Absolute dates now: a YYYY-MM-DD is treated as a local calendar date, so
    // logging on Jul 1 schedules from Jul 1 in every timezone.
    const first = (rating) => computeReviewDates("2026-07-01", rating, null)[0];
    const asDate = (d) => [d.getFullYear(), d.getMonth() + 1, d.getDate()];

    expect(asDate(first("good"))).toEqual([2026, 7, 3]);
    expect(asDate(first("okay"))).toEqual([2026, 7, 2]);
    expect(asDate(first("struggling"))).toEqual([2026, 7, 1]);
  });

  it("does not shift the logged day west of Greenwich", () => {
    // The bug this replaced: "2026-07-01" parsed as UTC then normalised to local
    // midnight became Jun 30, and every review landed a day early.
    const dates = computeReviewDates("2026-07-01", "struggling", null);
    expect(dates[0].getMonth() + 1).toBe(7);
    expect(dates[0].getDate()).toBe(1);
  });

  it("includes the weekend sweep and drops anything past the exam", () => {
    expect(getNextSaturday("2026-07-01").getDay()).toBe(6);
    const bounded = computeReviewDates("2026-07-01", "okay", "2026-07-10");
    expect(bounded.every((d) => d <= new Date("2026-07-10T00:00:00"))).toBe(true);
  });

  it("appends newest-first and bumps the session count", () => {
    const first = appendActivity({}, {
      lectureId: "lec1", blockId: "b1", activityType: "anki", confidenceRating: "good",
      date: "2026-07-01", id: "a1",
    });
    const second = appendActivity(first.store, {
      lectureId: "lec1", blockId: "b1", activityType: "review", confidenceRating: "okay",
      date: "2026-07-05", id: "a2",
    });

    expect(second.entry.activityLog.map((a) => a.id)).toEqual(["a2", "a1"]);
    expect(second.entry.sessionCount).toBe(2);
    expect(second.entry.firstCompletedDate).toBe("2026-07-01");
    expect(second.entry.lastActivityDate).toBe("2026-07-05");
    expect(second.entry.lastConfidence).toBe("okay");
  });

  it("marks anki rotation and never unmarks it", () => {
    const anki = appendActivity({}, { lectureId: "l", blockId: "b", activityType: "anki", date: "2026-07-01" });
    expect(anki.entry.ankiInRotation).toBe(true);
    const later = appendActivity(anki.store, { lectureId: "l", blockId: "b", activityType: "review", date: "2026-07-02" });
    expect(later.entry.ankiInRotation).toBe(true);
  });

  it("leaves other lectures alone and refuses an incomplete write", () => {
    const store = { "other__b1": { sessionCount: 9 } };
    const next = appendActivity(store, { lectureId: "l", blockId: "b1", date: "2026-07-01" });
    expect(next.store["other__b1"]).toBe(store["other__b1"]);
    expect(appendActivity(store, { blockId: "b1" })).toBeNull();
  });
});

describe("buildScheduleContext", () => {
  const stores = () => ({
    blockId: "b1",
    terms: [{ id: "t1", blocks: [{ id: "b1", startDate: "2026-01-05", name: "Block" }] }],
    lectures: [
      { id: "lec1", blockId: "b1", lectureTitle: "Histology of Bone" },
      { id: "lec2", blockId: "b2", lectureTitle: "Other block" },
    ],
    objectives: {
      b1: {
        imported: [
          { id: "o1", linkedLecId: "lec1", objective: "Describe the bone slide.", status: "struggling" },
          { id: "dup", linkedLecId: "lec1", objective: "describe the BONE slide!", status: "untested" },
        ],
        extracted: [],
      },
    },
    performance: { "lec1__b1": { lastScore: 55, sessions: [{ score: 55 }] } },
    examDates: { b1: "2026-12-01" },
    completion: {},
    reviewedLectures: {},
    now: new Date("2026-07-27T00:00:00Z"),
  });

  it("scopes lectures to the block and dedupes objectives", () => {
    const context = buildScheduleContext(stores());
    expect(context.lectures.map((l) => l.id)).toEqual(["lec1"]);
    expect(context.objectives.map((o) => o.id)).toEqual(["o1"]);
  });

  it("resolves blockMeta and study modes to data, with no callbacks left", () => {
    const context = buildScheduleContext(stores());
    expect(context.blockMeta).toMatchObject({ id: "b1", startDate: "2026-01-05" });
    expect(context.studyModeByLecture.lec1.mode).toBe("histology");
    for (const value of Object.values(context)) expect(typeof value).not.toBe("function");
  });

  it("feeds the pure schedulers directly", () => {
    const context = buildScheduleContext(stores());
    expect(buildStudySchedule(context).lecturePlans[0].lectureId ?? "lec1").toBeTruthy();
    expect(generateDailySchedule(context).lecScores[0].urgency).toBeGreaterThan(0);
  });

  it("finds the block record wherever it sits in the terms tree", () => {
    const terms = [{ id: "t1", blocks: [{ id: "x" }] }, { id: "t2", blocks: [{ id: "b1", startDate: "d" }] }];
    expect(resolveBlockMeta(terms, "b1")).toMatchObject({ id: "b1" });
    expect(resolveBlockMeta(terms, "missing")).toBeNull();
  });
});

describe("today's task list", () => {
  const score = (id, urgency, over = {}) => ({
    lec: { id },
    urgency,
    recommendedSessions: [{ type: "quiz", label: "Quiz", duration: 15 }],
    isFuture: false,
    ...over,
  });

  it("uses the planner's day 0 when it placed anything there", () => {
    const daily = {
      schedule: [{ daysFromNow: 0, tasks: [score("a", 50)] }],
      lecScores: [score("b", 99)],
    };
    const result = todayTasks(daily);
    expect(result.reason).toBe("scheduled");
    expect(result.tasks.map((t) => t.lec.id)).toEqual(["a"]);
  });

  it("adds only a small recent catch-up queue after today's scheduled work", () => {
    const daily = {
      schedule: [{ daysFromNow: 0, tasks: [score("today", 50, { matchReason: "scheduled-day" })] }],
      lecScores: [
        score("today", 50, { availableDate: new Date("2026-07-27T00:00:00"), sessions: 0 }),
        score("yesterday", 90, { availableDate: new Date("2026-07-26T00:00:00"), sessions: 0 }),
        score("three-days", 99, { availableDate: new Date("2026-07-24T00:00:00"), sessions: 0 }),
        score("older", 100, { availableDate: new Date("2026-07-10T00:00:00"), sessions: 0 }),
        score("started", 100, { availableDate: new Date("2026-07-25T00:00:00"), sessions: 1 }),
      ],
    };

    const result = todayTasks(daily, { todayStr: "2026-07-27" });
    expect(result.reason).toBe("scheduled-with-catch-up");
    expect(result.tasks.map((t) => t.lec.id)).toEqual(["today", "yesterday", "three-days"]);
    expect(result.tasks[1]).toMatchObject({ matchReason: "catch-up", catchUpDays: 1 });
  });

  it("does not pile up old or already-started lectures as catch-up work", () => {
    const daily = {
      lecScores: [
        score("recent", 50, { availableDate: new Date("2026-07-25T00:00:00"), sessions: 0 }),
        score("old", 99, { availableDate: new Date("2026-07-01T00:00:00"), sessions: 0 }),
        score("started", 100, { availableDate: new Date("2026-07-26T00:00:00"), sessions: 2 }),
      ],
    };
    expect(catchUpTasks(daily, { today: new Date("2026-07-27") }).map((t) => t.lec.id)).toEqual(["recent"]);
  });

  it("ignores a plan whose first day is not today", () => {
    const daily = {
      schedule: [{ daysFromNow: 3, tasks: [score("a", 50)] }],
      lecScores: [score("b", 99)],
    };
    expect(todayTasks(daily).reason).toBe("urgency-fallback");
  });

  it("falls back to the urgency ranking, capped", () => {
    const daily = {
      schedule: [],
      lecScores: Array.from({ length: 10 }, (_, i) => score(`l${i}`, 100 - i)),
    };
    const result = todayTasks(daily, { limit: 6, todayStr: "2026-07-27" });

    expect(result.reason).toBe("urgency-fallback");
    expect(result.tasks).toHaveLength(6);
    expect(result.tasks[0].lec.id).toBe("l0");
    expect(result.tasks[0]).toMatchObject({ matchReason: "urgency-fallback", dateStr: "2026-07-27" });
  });

  it("skips lectures with nothing to do and ones not yet available", () => {
    const daily = {
      schedule: [],
      lecScores: [
        score("done", 90, { recommendedSessions: [] }),
        score("future", 80, { isFuture: true }),
        score("real", 70),
      ],
    };
    expect(todayTasks(daily).tasks.map((t) => t.lec.id)).toEqual(["real"]);
  });

  it("says so when there is genuinely nothing", () => {
    expect(todayTasks({ schedule: [], lecScores: [] })).toEqual({ tasks: [], reason: "none" });
    expect(todayTasks(null).reason).toBe("none");
  });
});

describe("lecturePerformanceFor", () => {
  beforeEach(() => installDomStorage());

  it("prefers the exact key, then an older key for the same lecture", () => {
    const perf = { "lec1__b1": { lastScore: 90 }, "lec2__old": { lastScore: 10 } };
    expect(lecturePerformanceFor(perf, "lec1", "b1").lastScore).toBe(90);
    expect(lecturePerformanceFor(perf, "lec2", "b1").lastScore).toBe(10);
  });

  it("never falls back to another lecture", () => {
    expect(lecturePerformanceFor({ "lec1__b1": {} }, "lec9", "b1")).toBeNull();
  });
});
