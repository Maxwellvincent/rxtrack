import { describe, it, expect } from "vitest";
import { lectureUrgency, weakConceptsForLecture } from "./schedule.js";

const BASE_ARGS = {
  tally: { struggling: 0, untested: 0 },
  avgBloom: 2,
  lastScore: null,
  confidence: "High",
  sessions: 1,
  nextReview: null,
  today: new Date("2026-08-22"),
  reviewed: false,
  completion: null,
  zone: "normal",
};

describe("weakConceptsForLecture", () => {
  const store = {
    "block-1": [
      { concept: "radial nerve injury", masteryLevel: "struggling", linkedLecIds: ["lec-1"] },
      { concept: "already solid", masteryLevel: "mastered", linkedLecIds: ["lec-1"] },
      { concept: "unrelated", masteryLevel: "struggling", linkedLecIds: ["lec-2"] },
    ],
    lifetime: [{ concept: "radial nerve injury (lifetime copy)", blockId: "block-1", masteryLevel: "struggling", linkedLecIds: ["lec-1"] }],
    _summary: { "block-1": 3 },
  };

  it("returns only non-mastered concepts linked to this lecture, from block + lifetime", () => {
    const out = weakConceptsForLecture(store, "block-1", "lec-1");
    expect(out).toHaveLength(2);
    expect(out.every((c) => c.masteryLevel !== "mastered")).toBe(true);
  });

  it("returns nothing for a lecture with no linked concepts", () => {
    expect(weakConceptsForLecture(store, "block-1", "lec-99")).toEqual([]);
  });

  it("returns nothing without a lectureId", () => {
    expect(weakConceptsForLecture(store, "block-1", null)).toEqual([]);
  });

  it("ignores the _summary compaction bucket", () => {
    // A store with only a compacted _summary (no real arrays) must not throw or match anything.
    expect(weakConceptsForLecture({ "block-1": { _summary: true } }, "block-1", "lec-1")).toEqual([]);
  });
});

describe("lectureUrgency weak-concept boost", () => {
  it("adds nothing when there are no linked weak concepts", () => {
    const base = lectureUrgency(BASE_ARGS);
    const withZero = lectureUrgency({ ...BASE_ARGS, weakConceptCount: 0, hasLandmineWeakConcept: false });
    expect(withZero).toBe(base);
  });

  it("boosts urgency proportionally to weak concept count, capped", () => {
    const base = lectureUrgency(BASE_ARGS);
    const withOne = lectureUrgency({ ...BASE_ARGS, weakConceptCount: 1 });
    const withMany = lectureUrgency({ ...BASE_ARGS, weakConceptCount: 10 });
    expect(withOne).toBeGreaterThan(base);
    expect(withMany).toBeGreaterThan(withOne);
    expect(withMany - base).toBeLessThanOrEqual(18); // capped
  });

  it("adds an extra boost for a landmine-severity weak concept", () => {
    const withoutLandmine = lectureUrgency({ ...BASE_ARGS, weakConceptCount: 1, hasLandmineWeakConcept: false });
    const withLandmine = lectureUrgency({ ...BASE_ARGS, weakConceptCount: 1, hasLandmineWeakConcept: true });
    expect(withLandmine).toBeGreaterThan(withoutLandmine);
  });
});
