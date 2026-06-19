// src/recognitionBank.test.js
import { describe, it, expect } from "vitest";
import { pickWeightedItems } from "./recognitionBank.js";

const items = [
  { id: "1", subject: "Heart failure", weak_for: [], data: { vignette: "x", correctDiagnosis: "CHF" } },
  { id: "2", subject: "Glomerular", weak_for: ["Glomerular"], data: { vignette: "y", correctDiagnosis: "Nephritis" } },
  { id: "3", subject: "Random", weak_for: [], data: { vignette: "z", correctDiagnosis: "Other" } },
];

describe("pickWeightedItems", () => {
  it("puts weak-area items first (matched via weak_for/subject)", () => {
    const out = pickWeightedItems(items, ["Glomerular"], 3);
    expect(out[0].id).toBe("2");
    expect(out).toHaveLength(3);
  });
  it("matches a weak term against the item's vignette/diagnosis content", () => {
    const out = pickWeightedItems(items, ["nephritis"], 3);
    expect(out[0].id).toBe("2"); // 'Nephritis' is in item 2's data
  });
  it("returns n items when no weak terms", () => {
    expect(pickWeightedItems(items, [], 2)).toHaveLength(2);
  });
  it("handles empty input", () => {
    expect(pickWeightedItems([], ["x"], 5)).toEqual([]);
  });
});
