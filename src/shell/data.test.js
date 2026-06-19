import { describe, it, expect } from "vitest";
import { flattenBlocks } from "./data.js";

describe("flattenBlocks", () => {
  it("flattens terms→blocks with term metadata + lecture count", () => {
    const terms = [
      { id: "t1", name: "Term 1", color: "#3b82f6", blocks: [
        { id: "cpr1", name: "CPR 1" }, { id: "msk", name: "MSK" },
      ] },
    ];
    const lectures = [{ blockId: "cpr1" }, { blockId: "cpr1" }, { blockId: "msk" }];
    const out = flattenBlocks(terms, lectures);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ id: "cpr1", name: "CPR 1", termId: "t1", termName: "Term 1", termColor: "#3b82f6", lectureCount: 2 });
    expect(out[1].lectureCount).toBe(1);
  });
  it("handles missing blocks/lectures", () => {
    expect(flattenBlocks([], [])).toEqual([]);
    expect(flattenBlocks(null, null)).toEqual([]);
  });
});
