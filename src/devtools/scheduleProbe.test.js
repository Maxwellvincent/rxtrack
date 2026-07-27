import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { probeEnabled, captureContext, captureBlock } from "./scheduleProbe.js";

const FIXTURE_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../shell/logic/__fixtures__"
);

const deps = () => ({
  terms: [{ id: "t1", blocks: [{ id: "b1", startDate: "2026-01-01", name: "Block" }] }],
  lectures: [{ id: "lec1", blockId: "b1", lectureTitle: "One", lectureNumber: 1 }],
  examDates: { b1: "2026-12-01" },
  performanceHistory: { "lec1__b1": { lastScore: 70, sessions: [{ score: 70, extra: "dropped" }] } },
  reviewedLectures: {},
  getBlockObjectives: () => [
    { id: "o1", linkedLecId: "lec1", status: "struggling", bloom_level: 3, objective: "text dropped" },
  ],
  getBlockLecs: (lectures) => lectures,
  resolveBlockMeta: (id) => ({ id, startDate: "2026-01-01" }),
  detectStudyMode: () => "deepLearn",
  getLecPerf: () => ({ lastScore: 70, confidenceLevel: "Low", sessions: [{ score: 70 }] }),
  buildStudySchedule: vi.fn(() => null),
  generateDailySchedule: vi.fn(() => null),
  now: new Date("2026-07-27T00:00:00Z"),
});

describe("probeEnabled", () => {
  it("only fires for the explicit flag", () => {
    expect(probeEnabled("?probe=schedule")).toBe(true);
    expect(probeEnabled("?probe=other")).toBe(false);
    expect(probeEnabled("")).toBe(false);
    expect(probeEnabled("?shell=old")).toBe(false);
  });
});

describe("captureContext", () => {
  it("resolves blockMeta and study modes to data, not callbacks", () => {
    const context = captureContext(deps(), "b1");
    expect(context.blockMeta).toEqual({ id: "b1", startDate: "2026-01-01" });
    expect(context.studyModeByLecture).toEqual({ lec1: "deepLearn" });
    expect(typeof context.blockMeta).toBe("object");
  });

  it("records the exam date and the clock the capture ran against", () => {
    const context = captureContext(deps(), "b1");
    expect(context.examDate).toBe("2026-12-01");
    expect(context.now).toBe("2026-07-27T00:00:00.000Z");
  });

  it("keeps only the fields the schedule functions read", () => {
    const context = captureContext(deps(), "b1");
    expect(Object.keys(context.objectives[0]).sort()).toEqual(
      ["bloom_level", "id", "linkedLecId", "status"]
    );
    expect(context.performance["lec1__b1"].sessions[0]).toEqual({ score: 70 });
  });

  it("stores weak concepts as counts — neither function reads them", () => {
    const context = captureContext(deps(), "b1");
    expect(context.weakConcepts).toHaveProperty("_summary");
  });
});

describe("captureBlock", () => {
  it("calls both schedule functions with the block and its exam date", () => {
    const d = deps();
    captureBlock(d, "b1");
    expect(d.buildStudySchedule).toHaveBeenCalledWith("b1");
    expect(d.generateDailySchedule).toHaveBeenCalledWith("b1", "2026-12-01");
  });

  it("records a throwing function instead of losing the whole capture", () => {
    const d = { ...deps(), buildStudySchedule: () => { throw new Error("boom"); } };
    const captured = captureBlock(d, "b1");
    expect(captured.errors.buildStudySchedule).toBe("boom");
    expect(captured.context).toBeTruthy();
  });
});

describe("captured fixtures", () => {
  const files = fs
    .readdirSync(FIXTURE_DIR)
    .filter((f) => f.endsWith(".json") && !f.includes("_index"));

  it("has a fixture per block with an exam date", () => {
    expect(files.length).toBeGreaterThanOrEqual(6);
  });

  it.each(files)("%s is a clean, slim capture", (file) => {
    const fixture = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, file), "utf8"));

    expect(fixture.errors).toEqual({});
    expect(fixture.context.now).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(fixture.context.examDate).toBeTruthy();
    expect(Array.isArray(fixture.context.lectures)).toBe(true);
    expect(fixture.output).toHaveProperty("studySchedule");
    expect(fixture.output).toHaveProperty("dailySchedule");

    // Outputs must carry decisions, not echoed objective objects.
    const plans = fixture.output.studySchedule?.lecturePlans || [];
    for (const plan of plans) {
      expect(plan).not.toHaveProperty("lecObjs");
      expect(Array.isArray(plan.objectiveIds)).toBe(true);
    }
    for (const score of fixture.output.dailySchedule?.lecScores || []) {
      expect(score).not.toHaveProperty("lec");
      expect(score).toHaveProperty("urgency");
    }
  });

  it("keeps a past-exam block recording the daysLeft<=0 shape", () => {
    const past = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, "schedule_msk.json"), "utf8"));
    expect(past.output.studySchedule).toBeNull();
    expect(past.output.dailySchedule.daysLeft).toBe(0);
  });
});
