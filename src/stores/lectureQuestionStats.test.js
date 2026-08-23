import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installDomStorage } from "./testEnv.js";
import * as stats from "./lectureQuestionStats.js";
import { __setCloudBackendForTests, resetCloudStores } from "./cloudBase.js";

/** Same fake Firestore shape used in cloudBase.test.js. */
function makeBackend() {
  const listeners = new Map();
  const writes = [];
  return {
    listeners,
    writes,
    api: {
      doc: (_db, ...segments) => segments.join("/"),
      onSnapshot: (path, next, error) => {
        listeners.set(path, { next, error });
        return () => listeners.delete(path);
      },
      setDoc: (path, value) => { writes.push({ path, value }); return Promise.resolve(); },
      serverTimestamp: () => "SERVER_TS",
    },
  };
}

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

describe("recordAnswerAwait", () => {
  beforeEach(() => installDomStorage());

  it("returns the same stats shape as recordAnswer, for the signed-out path", async () => {
    const next = await stats.recordAnswerAwait(null, "lec1", true);
    expect(next.lec1).toMatchObject({ answered: 1, correct: 1 });
    expect(stats.statsForLecture(null, "lec1")).toMatchObject({ answered: 1, correct: 1 });
  });

  it("returns the current stats unchanged when there's no lecture to attach to", async () => {
    const next = await stats.recordAnswerAwait(null, null, true);
    expect(next).toEqual({});
  });

  describe("signed-in cloud path", () => {
    let backend;

    beforeEach(() => {
      backend = makeBackend();
      __setCloudBackendForTests(backend.api);
      vi.spyOn(console, "warn").mockImplementation(() => {});
    });

    afterEach(() => {
      resetCloudStores();
      __setCloudBackendForTests(null);
      vi.restoreAllMocks();
    });

    it("resolves with the updated stats on a successful write", async () => {
      const next = await stats.recordAnswerAwait("u1", "lec1", true);
      expect(next.lec1).toMatchObject({ answered: 1, correct: 1 });
      expect(backend.writes).toHaveLength(1);
    });

    it("propagates a write rejection instead of silently succeeding", async () => {
      __setCloudBackendForTests({ ...backend.api, setDoc: () => Promise.reject(new Error("offline")) });
      await expect(stats.recordAnswerAwait("u1", "lec1", true)).rejects.toThrow("offline");
    });
  });
});
