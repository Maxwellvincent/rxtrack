/**
 * The parity contract (SP1 T4.2).
 *
 * Every fixture was recorded from the running App. The pure module must
 * reproduce those outputs from the recorded context — that is the hard blocker
 * on flipping Today. A failure here means the extraction changed behaviour.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { availableDateFor, lecDateMap, buildStudySchedule, generateDailySchedule } from "./schedule.js";
import { studyScheduleShape, dailyScheduleShape } from "./scheduleFixtureShape.js";

const FIXTURE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "__fixtures__");

const fixtures = fs
  .readdirSync(FIXTURE_DIR)
  .filter((f) => f.endsWith(".json") && !f.includes("_index"))
  .map((file) => ({
    file,
    ...JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, file), "utf8")),
  }));

describe("local date parsing", () => {
  it("treats YYYY-MM-DD as a calendar date, not a UTC instant", () => {
    // App's bug, fixed here: west of Greenwich this used to land a day early,
    // so every dated lecture was scheduled one day before it happened.
    const lecture = { id: "l", lectureDate: "2026-09-01" };
    const { date } = availableDateFor(lecture, null);
    expect(date.getFullYear()).toBe(2026);
    expect(date.getMonth()).toBe(8); // September
    expect(date.getDate()).toBe(1);
  });

  it("still reads the legacy `date` field records were imported with", () => {
    expect(availableDateFor({ id: "l", date: "2026-09-01" }, null).date.getDate()).toBe(1);
  });

  it("DLA with no date inherits the same-numbered LEC date via pairedDate", () => {
    const lectures = [
      { id: "lec1", lectureType: "LEC", lectureNumber: 3, lectureDate: "2026-09-10" },
      { id: "dla1", lectureType: "DLA", lectureNumber: 3, lectureDate: null, date: null },
    ];
    const map = lecDateMap(lectures);
    const paired = map[3] ?? null;
    const { date, source } = availableDateFor(lectures[1], null, paired);
    expect(date.getDate()).toBe(10);
    expect(source).toBe("explicit");
  });

  it("DLA with its own date is not overridden by the paired LEC", () => {
    const lectures = [
      { id: "lec1", lectureType: "LEC", lectureNumber: 5, lectureDate: "2026-09-10" },
      { id: "dla1", lectureType: "DLA", lectureNumber: 5, lectureDate: "2026-09-15" },
    ];
    const map = lecDateMap(lectures);
    const paired = (!lectures[1].lectureDate && !lectures[1].date) ? (map[5] ?? null) : null;
    const { date } = availableDateFor(lectures[1], null, paired);
    expect(date.getDate()).toBe(15);
  });
});

describe("schedule parity with the recorded run", () => {
  it("has fixtures to check against", () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(6);
  });

  it.each(fixtures.map((f) => [f.file, f]))(
    "%s — buildStudySchedule matches the recorded output",
    (_file, fixture) => {
      const actual = buildStudySchedule(fixture.context);
      expect(studyScheduleShape(actual)).toEqual(fixture.output.studySchedule);
    }
  );

  it.each(fixtures.map((f) => [f.file, f]))(
    "%s — generateDailySchedule matches the recorded output",
    (_file, fixture) => {
      const actual = generateDailySchedule(fixture.context);
      expect(dailyScheduleShape(actual)).toEqual(fixture.output.dailySchedule);
    }
  );
});

describe("fixture integrity", () => {
  it.each(fixtures.map((f) => [f.file, f]))("%s recorded cleanly", (_file, fixture) => {
    expect(fixture.errors).toEqual({});
    expect(fixture.context.now).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(fixture.context.examDate).toBeTruthy();
    // Decisions, not echoed inputs — see the fixture README.
    for (const plan of fixture.output.studySchedule?.lecturePlans || []) {
      expect(plan).not.toHaveProperty("lecObjs");
      expect(Array.isArray(plan.objectiveIds)).toBe(true);
    }
    for (const score of fixture.output.dailySchedule?.lecScores || []) {
      expect(score).not.toHaveProperty("lec");
      expect(score).toHaveProperty("urgency");
    }
  });

  it("keeps the inputs the schedulers actually read", () => {
    const withLog = fixtures
      .flatMap((f) => Object.values(f.context.completion || {}))
      .filter((c) => c.activityLog?.length);
    expect(withLog.length).toBeGreaterThan(0);
    // confidenceRating drives up to 12 points of urgency via the trend.
    expect(withLog.some((c) => c.activityLog.some((a) => a.confidenceRating))).toBe(true);
  });
});

describe("what the fixtures pin down", () => {
  const byBlock = Object.fromEntries(fixtures.map((f) => [f.context.blockId, f]));

  it("returns null / the empty shape once the exam has passed", () => {
    const past = byBlock.msk;
    expect(buildStudySchedule(past.context)).toBeNull();
    expect(generateDailySchedule(past.context)).toMatchObject({ daysLeft: 0, schedule: [] });
  });

  it("reproduces the empty daily schedule for a block whose lectures have no dates", () => {
    // 34 days out, 24 lectures, and not one task lands: pass 3 skips every
    // dateless lecture. Recorded from App deliberately — see the fixture README.
    const endocrine = byBlock.mrspx2sg9go;
    const daily = generateDailySchedule(endocrine.context);
    expect(daily.daysLeft).toBeGreaterThan(30);
    expect(daily.lecScores.length).toBeGreaterThan(20);
    expect(daily.schedule).toEqual([]);
    expect(daily.lecScores.every((ls) => ls.hasNoDate)).toBe(true);
  });

  it("still plans spaced repetition for that block — the two schedulers disagree", () => {
    const study = buildStudySchedule(byBlock.mrspx2sg9go.context);
    expect(study.totalSessions).toBeGreaterThan(0);
    expect(study.schedule.length).toBeGreaterThan(0);
  });
});

describe("purity", () => {
  it("takes `now` as input rather than reading the clock for day maths", () => {
    const fixture = fixtures.find((f) => f.context.blockId === "mrspx2sg9go");
    const later = {
      ...fixture.context,
      now: new Date(new Date(fixture.context.now).getTime() + 10 * 24 * 60 * 60 * 1000).toISOString(),
    };
    expect(generateDailySchedule(later).daysLeft).toBe(
      generateDailySchedule(fixture.context).daysLeft - 10
    );
  });

  it("does not mutate the context it was given", () => {
    const fixture = fixtures.find((f) => f.context.blockId === "mrspx2sg9go");
    const before = JSON.stringify(fixture.context);
    buildStudySchedule(fixture.context);
    generateDailySchedule(fixture.context);
    expect(JSON.stringify(fixture.context)).toBe(before);
  });

  it("needs no App callbacks — blockMeta and study modes arrive as data", () => {
    const fixture = fixtures.find((f) => f.context.blockId === "mrspx2sg9go");
    for (const value of Object.values(fixture.context)) {
      expect(typeof value).not.toBe("function");
    }
  });
});
