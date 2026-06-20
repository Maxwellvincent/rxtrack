// src/shell/fuzzy.test.js
import { describe, it, expect } from "vitest";
import { fuzzyFilter } from "./fuzzy.js";

const items = [{ id: "1", label: "CPR 1" }, { id: "2", label: "MSK" }, { id: "3", label: "Cardiac Cycle" }];

describe("fuzzyFilter", () => {
  it("subsequence-matches case-insensitively", () => {
    expect(fuzzyFilter(items, "cc").map((i) => i.id)).toEqual(["3"]);
    expect(fuzzyFilter(items, "msk").map((i) => i.id)).toEqual(["2"]);
  });
  it("returns all on empty query", () => {
    expect(fuzzyFilter(items, "")).toHaveLength(3);
  });
  it("returns [] on no match", () => {
    expect(fuzzyFilter(items, "zzz")).toEqual([]);
  });
});
