import { describe, expect, it } from "vitest";
import {
  flattenWeakConcepts,
  dedupeConcepts,
  isLandmine,
  rankConcepts,
  weakConceptView,
} from "./weakConcepts.js";
import {
  lectureRow,
  matchesFilter,
  matchesSearch,
  buildLectureRows,
  lectureCounts,
  scoreLectures,
  inferActivityType,
} from "./lectureRows.js";

const concept = (over = {}) => ({
  id: over.id ?? over.concept ?? "c1",
  concept: "Preload and afterload",
  masteryLevel: "struggling",
  missCount: 2,
  totalAttempts: 3,
  consecutiveCorrect: 0,
  ...over,
});

describe("flattenWeakConcepts", () => {
  const store = {
    // "a" is msk's own concept, also mirrored into lifetime (as recordWrongAnswer does)
    lifetime: [concept({ id: "a", blockId: "msk" }), concept({ id: "c", blockId: "cpr1" })],
    msk: [concept({ id: "b", blockId: "msk" })],
    cpr1: [concept({ id: "c", blockId: "cpr1" })],
    _summary: { msk: 1 },
  };

  it("flattens every bucket and tags where each came from", () => {
    const all = flattenWeakConcepts(store);
    expect(all.map((c) => c.bucket).sort()).toEqual(["cpr1", "lifetime", "lifetime", "msk"]);
  });

  it("scopes to a block: lifetime entries from OTHER blocks do not bleed in", () => {
    expect(flattenWeakConcepts(store, { blockId: "msk" }).map((c) => c.id).sort()).toEqual(["a", "b"]);
    expect(flattenWeakConcepts(store, { blockId: "msk" }).some((c) => c.id === "c")).toBe(false);
    expect(flattenWeakConcepts(store, { blockId: "msk", includeLifetime: false }).map((c) => c.id)).toEqual(["b"]);
  });

  it("skips the compaction summary and text-less rows", () => {
    expect(flattenWeakConcepts(store).some((c) => c.bucket === "_summary")).toBe(false);
    expect(flattenWeakConcepts({ msk: [{ missCount: 3 }] })).toEqual([]);
  });
});

describe("dedupeConcepts", () => {
  it("keeps the record with the most evidence when a concept is in two buckets", () => {
    const deduped = dedupeConcepts([
      concept({ id: "same", missCount: 1, bucket: "msk" }),
      concept({ id: "same", missCount: 5, bucket: "lifetime" }),
    ]);
    expect(deduped).toHaveLength(1);
    expect(deduped[0].missCount).toBe(5);
  });
});

describe("isLandmine", () => {
  it("flags repeatedly missed concepts never yet held down", () => {
    expect(isLandmine(concept())).toBe(true);
    expect(isLandmine(concept({ missCount: 1 }))).toBe(false);
    expect(isLandmine(concept({ consecutiveCorrect: 1 }))).toBe(false);
    expect(isLandmine(concept({ masteryLevel: "mastered" }))).toBe(false);
  });
});

describe("rankConcepts", () => {
  it("puts struggling first, then most-missed", () => {
    const ranked = rankConcepts([
      concept({ id: "mastered", masteryLevel: "mastered", missCount: 9 }),
      concept({ id: "dev", masteryLevel: "developing", missCount: 1 }),
      concept({ id: "worst", missCount: 7 }),
      concept({ id: "bad", missCount: 3 }),
    ]);
    expect(ranked.map((c) => c.id)).toEqual(["worst", "bad", "dev", "mastered"]);
  });
});

describe("weakConceptView", () => {
  const store = {
    msk: [
      concept({ id: "a", missCount: 4 }),
      concept({ id: "b", masteryLevel: "mastered", missCount: 1, consecutiveCorrect: 3 }),
      concept({ id: "c", masteryLevel: "developing", missCount: 2, consecutiveCorrect: 1 }),
    ],
  };

  it("hides mastered by default and counts everything", () => {
    const view = weakConceptView(store, { blockId: "msk" });
    expect(view.concepts.map((c) => c.id)).toEqual(["a", "c"]);
    expect(view.counts).toMatchObject({ total: 3, mastered: 1, struggling: 1, developing: 1, landmines: 1 });
  });

  it("can include mastered, and can cap the list", () => {
    expect(weakConceptView(store, { includeMastered: true }).concepts).toHaveLength(3);
    expect(weakConceptView(store, { limit: 1 }).concepts).toHaveLength(1);
  });

  it("surfaces landmines separately", () => {
    expect(weakConceptView(store).landmines.map((c) => c.id)).toEqual(["a"]);
  });
});

describe("lecture rows", () => {
  const score = (over = {}) => ({
    lec: { id: "lec1", lectureTitle: "Cardiac Cycle", lectureType: "LEC", lectureNumber: 4 },
    urgency: 30,
    struggling: 1,
    untested: 2,
    mastered: 3,
    total: 6,
    sessions: 2,
    lastScore: 70,
    confidence: "Low",
    recommendedSessions: [],
    hasNoDate: true,
    ...over,
  });
  const completion = {
    "lec1__b1": { lastActivityDate: "2026-07-20", lastConfidence: "okay", reviewDates: ["2026-07-27"], ankiInRotation: true },
  };

  it("projects coverage and the completion record onto the row", () => {
    const row = lectureRow(score(), { completion, blockId: "b1" });
    expect(row).toMatchObject({
      lectureId: "lec1", title: "Cardiac Cycle", coverage: 50,
      lastActivityDate: "2026-07-20", nextReview: "2026-07-27", ankiInRotation: true, done: false,
    });
  });

  it("marks a lecture done only when every objective is mastered", () => {
    expect(lectureRow(score({ mastered: 6, struggling: 0, untested: 0 }), { blockId: "b1" }).done).toBe(true);
    expect(lectureRow(score({ total: 0, mastered: 0 }), { blockId: "b1" }).done).toBe(false);
  });

  it("filters and searches", () => {
    const row = lectureRow(score(), { completion, blockId: "b1" });
    expect(matchesFilter(row, "struggling")).toBe(true);
    expect(matchesFilter(row, "unstarted")).toBe(false);
    expect(matchesFilter(row, "all")).toBe(true);
    expect(matchesSearch(row, "cardiac")).toBe(true);
    expect(matchesSearch(row, "LEC 4")).toBe(true);
    expect(matchesSearch(row, "renal")).toBe(false);
  });

  it("infers DLA and other activity types from legacy titles when lectureType is missing", () => {
    expect(inferActivityType({ lectureTitle: "DLA 4 — Pelvic anatomy" })).toBe("DLA");
    expect(inferActivityType({ filename: "ER TBL 2.pdf" })).toBe("TBL");
  });

  it("filters the focused today view by scheduled or completed date", () => {
    const row = lectureRow(score({ todayKey: "2026-07-20", scheduledToday: true }), { completion, blockId: "b1" });
    expect(row.completedToday).toBe(true);
    expect(matchesFilter(row, "today")).toBe(true);
  });

  it("sorts by urgency by default, and counts over the unfiltered set", () => {
    const scores = [
      score({ urgency: 10, lec: { id: "a", lectureTitle: "A", lectureNumber: 2 } }),
      score({ urgency: 90, lec: { id: "b", lectureTitle: "B", lectureNumber: 1 } }),
    ];
    expect(buildLectureRows(scores, { blockId: "b1", completion }).map((r) => r.lectureId)).toEqual(["b", "a"]);
    expect(buildLectureRows(scores, { blockId: "b1", completion, sort: "lecture" }).map((r) => r.lectureId)).toEqual(["b", "a"]);
    expect(buildLectureRows(scores, { blockId: "b1", completion, filter: "unstarted" })).toEqual([]);
    expect(lectureCounts(scores, { blockId: "b1", completion })).toMatchObject({ all: 2, struggling: 2, untested: 2 });
  });
});

describe("scoreLectures", () => {
  const context = (over = {}) => ({
    blockId: "b1",
    now: "2026-07-27T00:00:00.000Z",
    lectures: [
      { id: "lec1", blockId: "b1", lectureTitle: "One" },
      { id: "lec2", blockId: "b1", lectureTitle: "Two" },
    ],
    objectives: [
      { id: "o1", linkedLecId: "lec1", status: "struggling", bloom_level: 3 },
      { id: "o2", linkedLecId: "lec1", status: "untested", bloom_level: 2 },
    ],
    completion: {},
    reviewedLectures: {},
    lecturePerformance: {},
    studyModeByLecture: { lec1: { mode: "physiology" } },
    blockMeta: null,
    examDate: "2026-12-01",
    ...over,
  });

  it("scores every lecture in the block", () => {
    const scores = scoreLectures(context());
    expect(scores.map((s) => s.lec.id)).toEqual(["lec1", "lec2"]);
    expect(scores[0].struggling).toBe(1);
    expect(scores[0].urgency).toBeGreaterThan(scores[1].urgency);
    expect(scores[0].studyMode).toEqual({ mode: "physiology" });
  });

  it("still scores when the exam has passed — the list must not empty out", () => {
    // This is the bug it exists to fix: generateDailySchedule returns nothing
    // for a finished block, which made the lecture list show zero lectures.
    const past = scoreLectures(context({ examDate: "2026-03-25" }));
    expect(past).toHaveLength(2);
    expect(past[0].urgency).toBeGreaterThan(0);
  });

  it("works with no exam date at all", () => {
    expect(scoreLectures(context({ examDate: null }))).toHaveLength(2);
  });

  it("recommends a first deep learn for a never-studied lecture", () => {
    expect(scoreLectures(context())[1].recommendedSessions[0].type).toBe("deepLearn");
  });
});
