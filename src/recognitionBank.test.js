import { describe, it, expect } from "vitest";
import { pickWeightedItems } from "./recognitionBank.js";

const items = [
  { id: "1", subject: "Heart failure", weak_for: [] },
  { id: "2", subject: "Glomerular", weak_for: ["Glomerular"] },
  { id: "3", subject: "Random", weak_for: [] },
];

describe("pickWeightedItems", () => {
  it("puts weak-area items first", () => {
    const out = pickWeightedItems(items, ["Glomerular"], 3);
    expect(out[0].id).toBe("2");
    expect(out).toHaveLength(3);
  });
  it("returns n items when no weak subjects", () => {
    expect(pickWeightedItems(items, [], 2)).toHaveLength(2);
  });
  it("handles empty input", () => {
    expect(pickWeightedItems([], ["x"], 5)).toEqual([]);
  });
});
