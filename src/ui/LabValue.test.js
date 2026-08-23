import { describe, it, expect } from "vitest";
import { parseText } from "./LabValue.jsx";

function labParts(text) {
  return parseText(text).filter((p) => p.type === "lab");
}

describe("parseText — colon/report style (already worked)", () => {
  it("matches 'Term: value unit'", () => {
    const parts = labParts("Serum Sodium: 107 mmol/L (normal: 135–145 mmol/L)");
    expect(parts).toHaveLength(1);
    expect(parts[0].value).toBe(107);
    expect(parts[0].lab.name).toContain("Sodium");
  });

  it("matches 'Term value unit' with no colon", () => {
    const parts = labParts("Serum Potassium 2.4 mEq/L (normal: 3.5-5.0 mEq/L)");
    expect(parts).toHaveLength(1);
    expect(parts[0].value).toBe(2.4);
  });
});

describe("parseText — natural sentence phrasing (real exam vignette style)", () => {
  it("matches 'term of value'", () => {
    const parts = labParts("serum sodium of 126 mEq/L (Normal: 135-145)");
    expect(parts).toHaveLength(1);
    expect(parts[0].value).toBe(126);
  });

  it("matches 'term is value'", () => {
    const parts = labParts("blood glucose is 20 mg/dL (normal is 70-110mg/dL)");
    expect(parts).toHaveLength(1);
    expect(parts[0].value).toBe(20);
  });

  it("matches 'term was value'", () => {
    const parts = labParts("Her serum potassium was 2.4 mEq/L on admission.");
    expect(parts).toHaveLength(1);
    expect(parts[0].value).toBe(2.4);
  });

  it("matches through a couple of filler words without crossing into an unrelated number", () => {
    const parts = labParts("Her serum sodium concentration is 107 mmol/L, down from 140 last week.");
    expect(parts).toHaveLength(1);
    expect(parts[0].value).toBe(107);
  });

  it("does not falsely match an unrelated number far from the term", () => {
    const parts = labParts("The patient is 45 years old. Serum glucose is 90 mg/dL.");
    expect(parts).toHaveLength(1);
    expect(parts[0].value).toBe(90);
  });
});
