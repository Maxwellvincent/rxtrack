import { describe, expect, it } from "vitest";
import { cacheEntry, preReadSignature, preReadsToGenerate, readCached } from "./preReadCache.js";

const lecture = { id: "lec1", lectureTitle: "Adrenal Steroidogenesis", subject: "Endocrine" };
const objectives = [
  { id: "o1", objective: "Describe cortisol synthesis" },
  { id: "o2", objective: "Explain the HPA axis" },
];
const generated = { topics: ["cortisol synthesis"], questions: [{ id: "pr_1" }], sourceKind: "objectives" };
const NOW = new Date("2026-08-16T09:00:00");

describe("preReadSignature", () => {
  it("changes when the objectives change", () => {
    const before = preReadSignature(lecture, objectives);
    const after = preReadSignature(lecture, [...objectives, { id: "o3", objective: "New one" }]);
    expect(after).not.toBe(before);
  });

  it("changes when lecture material arrives", () => {
    const before = preReadSignature(lecture, objectives);
    const after = preReadSignature({ ...lecture, chunks: [{ markdown: "x".repeat(400) }] }, objectives);
    expect(after).not.toBe(before);
  });

  it("is stable across calls with the same inputs", () => {
    expect(preReadSignature(lecture, objectives)).toBe(preReadSignature(lecture, objectives));
  });
});

describe("readCached", () => {
  const store = { lec1: cacheEntry(lecture, objectives, generated, NOW) };

  it("returns the generated pre-read when nothing has changed", () => {
    expect(readCached(store, lecture, objectives, { now: NOW })?.topics).toEqual(["cortisol synthesis"]);
  });

  it("misses once the objectives it was built from changed", () => {
    const changed = [...objectives, { id: "o3", objective: "Late addition" }];
    expect(readCached(store, lecture, changed, { now: NOW })).toBe(null);
  });

  it("misses once it is older than the TTL", () => {
    const old = new Date("2026-07-01T09:00:00");
    const stale = { lec1: cacheEntry(lecture, objectives, generated, old) };
    expect(readCached(stale, lecture, objectives, { now: NOW })).toBe(null);
  });
});

describe("preReadsToGenerate", () => {
  const other = { id: "lec2", lectureTitle: "Pituitary Axis" };

  it("lists only the lectures with no usable cache entry", () => {
    const store = { lec1: cacheEntry(lecture, objectives, generated, NOW) };
    const todo = preReadsToGenerate(
      [{ lec: lecture }, { lec: other }],
      store,
      { objectivesFor: () => objectives, now: NOW }
    );
    expect(todo.map((l) => l.id)).toEqual(["lec2"]);
  });

  it("never queues more than the prefetch limit at once", () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ lec: { id: `l${i}`, lectureTitle: `L${i}` } }));
    const todo = preReadsToGenerate(many, {}, { objectivesFor: () => [], now: NOW });
    expect(todo).toHaveLength(2);
  });
});
