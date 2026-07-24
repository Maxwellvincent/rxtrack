import { describe, it, expect } from "vitest";
import { normalizeHighYield, HY_TYPES } from "./highYield.js";

describe("normalizeHighYield", () => {
  it("keeps only the four valid types and maps common synonyms", () => {
    const raw = [
      { type: "definition", term: "Insulin", content: "Anabolic peptide hormone from beta cells." },
      { type: "MOA", term: "Insulin signaling", content: "Binds RTK → GLUT4 translocation." },
      { type: "relationship", term: "Glucagon vs insulin", content: "Opposing effects on blood glucose." },
      { type: "result", term: "Hyperglycemia", content: "Result of insulin deficiency." },
      { type: "fluff", term: "History", content: "Banting discovered insulin in 1921." },
    ];
    const out = normalizeHighYield(raw);
    expect(out.map((a) => a.type)).toEqual(["definition", "mechanism", "relationship", "result"]);
    expect(HY_TYPES).toContain("mechanism");
  });

  it("drops entries missing a term or content", () => {
    const out = normalizeHighYield([
      { type: "definition", term: "", content: "no term" },
      { type: "mechanism", term: "x", content: "" },
      { type: "definition", term: "TSH", content: "Stimulates thyroid follicular cells." },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].term).toBe("TSH");
  });

  it("dedupes by type+term (case-insensitive), keeping the first", () => {
    const out = normalizeHighYield([
      { type: "definition", term: "Cortisol", content: "first" },
      { type: "definition", term: "cortisol", content: "second (dupe)" },
      { type: "mechanism", term: "Cortisol", content: "different type, kept" },
    ]);
    expect(out).toHaveLength(2);
    expect(out.find((a) => a.type === "definition").content).toBe("first");
  });

  it("tolerates non-array / garbage input", () => {
    expect(normalizeHighYield(null)).toEqual([]);
    expect(normalizeHighYield({ details: [] })).toEqual([]);
    expect(normalizeHighYield([1, "x", null])).toEqual([]);
  });

  it("caps the list length", () => {
    const many = Array.from({ length: 100 }, (_, i) => ({ type: "definition", term: "t" + i, content: "c" + i }));
    expect(normalizeHighYield(many).length).toBeLessThanOrEqual(60);
  });
});
