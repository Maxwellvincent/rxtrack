import { describe, it, expect } from "vitest";
import { pickItemForConcept } from "./content.js";

const items = [
  { id: "1", subject: "Heart failure", data: { correctDiagnosis: "CHF" } },
  { id: "2", subject: "Renal", data: { correctDiagnosis: "Nephritis", vignette: "glomerular crescents" } },
];

describe("pickItemForConcept", () => {
  it("matches a concept against item content", () => {
    expect(pickItemForConcept(items, "glomerular").id).toBe("2");
  });
  it("falls back to first item when no match", () => {
    expect(pickItemForConcept(items, "zzz").id).toBe("1");
  });
  it("returns null for empty items", () => {
    expect(pickItemForConcept([], "x")).toBeNull();
  });
});
