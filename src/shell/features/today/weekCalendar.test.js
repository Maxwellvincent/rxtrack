import { describe, expect, it } from "vitest";
import { buildWeekCalendar, frozenDayQueue, lectureReviewNeed, planStudyLoad, weekStart } from "./weekCalendar.js";

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

describe("planStudyLoad", () => {
  const fp = (complete, total = 4) => ({ complete, covered: complete ? total : 0, total });
  const row = (id, givenOn, reviews = [], firstPass = fp(true)) => ({ id, givenOn, reviews: new Set(reviews), firstPass });

  it("spreads clustered reviews so no day goes over the daily limit", () => {
    // Eight lectures all due for review on the same two days, as on the Today calendar.
    const rows = Array.from({ length: 8 }, (_, i) => row(`r${i}`, "2026-11-10", ["2026-11-25", "2026-11-27", "2026-11-30"]));
    const plan = planStudyLoad(rows, { todayKey: "2026-11-25", examKey: "2026-12-01" });
    const loads = [...plan.byDay.values()].map((day) => day.units);
    expect(Math.max(...loads)).toBeLessThanOrEqual(6);
    expect(loads.reduce((a, b) => a + b, 0) + plan.skipped.length).toBe(24); // each review placed or explicitly dropped
    expect(plan.byDay.get("2026-11-26").units).toBeGreaterThan(0); // the empty day takes some
  });

  it("schedules first passes that fell behind as catch-up from today, never in the past", () => {
    const rows = [row("late1", "2026-11-23", [], fp(false)), row("late2", "2026-11-24", [], fp(false)), row("noObj", "2026-11-20", [], fp(false, 0))];
    const plan = planStudyLoad(rows, { todayKey: "2026-11-25", examKey: "2026-12-01" });
    expect(plan.behind).toBe(2);
    const placed = [...plan.byDay.entries()].flatMap(([key, day]) => day.items.map((item) => [item.row.id, key, item.kind]));
    expect(placed.map(([id]) => id).sort()).toEqual(["late1", "late2"]);
    expect(placed.every(([, key, kind]) => key === "2026-11-25" && kind === "catchup")).toBe(true);
  });

  it("never goes over the daily limit, caps first passes per day and reports what cannot fit", () => {
    const behind = Array.from({ length: 30 }, (_, i) => row(`f${i}`, "2026-11-20", [], fp(false)));
    const plan = planStudyLoad(behind, { todayKey: "2026-11-25", examKey: "2026-12-01" });
    for (const day of plan.byDay.values()) expect(day.items.length).toBeLessThanOrEqual(3);
    expect(plan.unscheduled.length).toBe(30 - 3 * 6);
  });
});

describe("review priority by mastery", () => {
  const done = { complete: true, covered: 4, total: 4 };
  const row = (id, need, secure = false) => ({ id, givenOn: "2026-11-10", reviews: new Set(["2026-11-29", "2026-11-30"]), firstPass: done, strength: { need, secure } });

  it("skips reviews for secure lectures and drops low-need reviews before weak ones when the tail end is full", () => {
    const rows = [row("secure", 0, true), ...Array.from({ length: 6 }, (_, i) => row(`weak${i}`, 0.9)), ...Array.from({ length: 6 }, (_, i) => row(`ok${i}`, 0.2))];
    const plan = planStudyLoad(rows, { todayKey: "2026-11-28", examKey: "2026-12-01" });
    const placed = [...plan.byDay.values()].flatMap((day) => day.items.map((item) => item.row.id));
    expect(plan.secure).toBe(1);
    expect(placed).not.toContain("secure");
    for (let i = 0; i < 6; i++) expect(placed.filter((id) => id === `weak${i}`).length).toBe(2);
    expect(plan.skipped.every((item) => item.row.id.startsWith("ok"))).toBe(true);
  });
});

describe("lectureReviewNeed", () => {
  const objectives = [{ id: "o1" }, { id: "o2" }];
  const ev = (a, c) => ({ objectives: { o1: { attempts: a, correct: c, recent: [true] }, o2: { attempts: a, correct: c, recent: [true] } } });
  it("marks a lecture secure at 80%+ with enough independent answers", () => {
    expect(lectureReviewNeed(objectives, ev(5, 5), { complete: true }).secure).toBe(true);
    expect(lectureReviewNeed(objectives, ev(5, 2), { complete: true }).secure).toBe(false);
    expect(lectureReviewNeed(objectives, {}, { complete: false }).need).toBe(1);
  });
});

describe("review findings", () => {
  const fp = { complete: true, covered: 2, total: 2 };
  it("a lecture with a struggling objective is not secure even at high overall accuracy", () => {
    const objectives = [{ id: "o1" }, { id: "o2" }];
    const evidence = { objectives: { o1: { attempts: 10, correct: 10, recent: [true] }, o2: { attempts: 3, correct: 2, recent: [true, true, false] } } };
    const need = lectureReviewNeed(objectives, evidence, fp);
    expect(need.struggling).toBe(1);
    expect(need.secure).toBe(false);
  });
  it("counts tomorrow's first passes when deciding to pull reviews forward into today", () => {
    const first = Array.from({ length: 3 }, (_, i) => ({ id: `new${i}`, givenOn: "2026-11-26", reviews: new Set(), firstPass: { complete: false, covered: 0, total: 3 } }));
    const reviews = Array.from({ length: 4 }, (_, i) => ({ id: `rev${i}`, givenOn: "2026-11-10", reviews: new Set(["2026-11-26"]), firstPass: fp }));
    const plan = planStudyLoad([...first, ...reviews], { todayKey: "2026-11-25", examKey: "2026-12-01" });
    expect(plan.byDay.get("2026-11-25").items.some((item) => item.kind === "review")).toBe(true);
    expect(plan.skipped).toEqual([]);
  });
  it("plans nothing on or after the exam day", () => {
    const rows = [{ id: "a", givenOn: "2026-11-20", reviews: new Set(["2026-12-02"]), firstPass: { complete: false, covered: 0, total: 3 } }];
    const plan = planStudyLoad(rows, { todayKey: "2026-12-01", examKey: "2026-12-01" });
    expect(plan.byDay.size).toBe(0);
    expect(plan.unscheduled).toEqual([]);
  });
});

describe("frozenDayQueue", () => {
  const row = id => ({ id, title: id });
  const fresh = ids => ids.map(([id, kind]) => ({ row: row(id), kind }));
  const stored = { cap: 3, items: [{ id: "a", kind: "first" }, { id: "b", kind: "first" }, { id: "c", kind: "review" }] };

  it("never backfills a frozen plan when a planned lecture is not loaded yet", () => {
    const rows = [row("a"), row("c"), row("d")]; // "b" still loading
    const queue = frozenDayQueue({ stored, fresh: fresh([["a", "first"], ["d", "first"], ["c", "review"]]), rows, limit: 3 });
    expect(queue.map(item => item.row.id)).toEqual(["a", "c"]);
  });

  it("keeps the frozen items when the plan is recomputed after progress", () => {
    const rows = ["a", "b", "c", "d"].map(row);
    const queue = frozenDayQueue({ stored, fresh: fresh([["a", "review"], ["d", "first"], ["c", "review"]]), rows, limit: 3 });
    expect(queue.map(item => `${item.row.id}:${item.kind}`)).toEqual(["a:first", "b:first", "c:review"]);
  });

  it("adds newly planned items only when the daily limit is raised after freezing", () => {
    const rows = ["a", "b", "c", "d", "e"].map(row);
    const queue = frozenDayQueue({ stored, fresh: fresh([["d", "first"], ["e", "review"]]), rows, limit: 4 });
    expect(queue.map(item => item.row.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("reads a frozen plan saved before the cap was stored as its own size", () => {
    const rows = ["a", "b", "c", "d"].map(row);
    expect(frozenDayQueue({ stored: stored.items, fresh: fresh([["d", "first"]]), rows, limit: 3 }).map(item => item.row.id)).toEqual(["a", "b", "c"]);
  });

  it("uses the fresh plan until one is frozen", () => {
    expect(frozenDayQueue({ stored: null, fresh: fresh([["a", "first"]]), rows: [row("a")], limit: 3 }).map(item => item.row.id)).toEqual(["a"]);
  });
});
