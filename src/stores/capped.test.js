import { describe, expect, it } from "vitest";
import { applyLocalCap, capArray, capMapEntries, LOCAL_CAPS } from "./capped.js";

describe("capArray", () => {
  it("keeps the newest entries at the tail", () => {
    expect(capArray([1, 2, 3, 4, 5], 3)).toEqual([3, 4, 5]);
  });

  it("leaves a short list alone", () => {
    expect(capArray([1, 2], 5)).toEqual([1, 2]);
  });

  it("copes with nothing", () => {
    expect(capArray(null, 5)).toEqual([]);
    expect(capArray(undefined, 5)).toEqual([]);
  });
});

describe("capMapEntries", () => {
  it("keeps the most recently stamped entries", () => {
    const map = {
      a: { savedAt: "2026-01-01" },
      b: { savedAt: "2026-03-01" },
      c: { savedAt: "2026-02-01" },
    };
    expect(Object.keys(capMapEntries(map, 2)).sort()).toEqual(["b", "c"]);
  });

  it("falls back to insertion order for unstamped entries", () => {
    const map = { a: { q: 1 }, b: { q: 2 }, c: { q: 3 } };
    expect(Object.keys(capMapEntries(map, 2))).toEqual(["b", "c"]);
  });

  it("prefers stamped entries over unstamped ones", () => {
    const map = { old: { q: 1 }, older: { q: 2 }, fresh: { savedAt: "2026-05-01" } };
    expect(Object.keys(capMapEntries(map, 1))).toEqual(["fresh"]);
  });

  it("leaves a small map alone, and survives junk", () => {
    const map = { a: 1, b: 2 };
    expect(capMapEntries(map, 5)).toBe(map);
    expect(capMapEntries(null, 5)).toEqual({});
    expect(capMapEntries([1, 2, 3], 2)).toEqual({});
  });
});

describe("applyLocalCap", () => {
  it("caps the stores that have a cap", () => {
    const many = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`k${i}`, { q: i }]));
    expect(Object.keys(applyLocalCap("rxt-mcq-bank", many))).toHaveLength(LOCAL_CAPS["rxt-mcq-bank"]);

    const missed = Array.from({ length: 200 }, (_, i) => i);
    expect(applyLocalCap("rxt-missed-questions", missed)).toHaveLength(LOCAL_CAPS["rxt-missed-questions"]);
  });

  it("passes anything else through untouched", () => {
    const objectives = { b1: { extracted: [1, 2, 3] } };
    expect(applyLocalCap("rxt-block-objectives", objectives)).toBe(objectives);
  });
});
