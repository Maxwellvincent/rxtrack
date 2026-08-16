import { beforeEach, describe, expect, it } from "vitest";
import { installDomStorage } from "./testEnv.js";
import * as stats from "./lectureQuestionStats.js";

// Signed out, so the store answers straight out of localStorage — the same path the anon
// prototype and the offline laptop take.
describe("lectureQuestionStats store", () => {
  beforeEach(() => installDomStorage());

  it("reports zeroes for a lecture never quizzed", () => {
    expect(stats.statsForLecture(null, "lec1")).toEqual({ answered: 0, correct: 0, accuracy: null });
  });

  it("counts every answer, right or wrong", () => {
    stats.recordAnswer(null, "lec1", true);
    stats.recordAnswer(null, "lec1", false);
    stats.recordAnswer(null, "lec1", true);
    expect(stats.statsForLecture(null, "lec1")).toMatchObject({ answered: 3, correct: 2 });
    expect(stats.statsForLecture(null, "lec1").accuracy).toBeCloseTo(2 / 3);
  });

  it("keeps lectures separate", () => {
    stats.recordAnswer(null, "lec1", true);
    stats.recordAnswer(null, "lec2", false);
    expect(stats.statsForLecture(null, "lec1").answered).toBe(1);
    expect(stats.statsForLecture(null, "lec2").correct).toBe(0);
  });

  it("keeps counting across re-runs of the same lecture", () => {
    for (let i = 0; i < 12; i++) stats.recordAnswer(null, "lec1", i % 2 === 0);
    expect(stats.statsForLecture(null, "lec1")).toMatchObject({ answered: 12, correct: 6 });
  });

  it("ignores an answer with no lecture to attach it to", () => {
    stats.recordAnswer(null, null, true);
    expect(stats.read(null)).toEqual({});
  });

  it("clears one lecture without touching the others", () => {
    stats.recordAnswer(null, "lec1", true);
    stats.recordAnswer(null, "lec2", true);
    stats.clearLecture(null, "lec1");
    expect(stats.statsForLecture(null, "lec1").answered).toBe(0);
    expect(stats.statsForLecture(null, "lec2").answered).toBe(1);
  });
});
