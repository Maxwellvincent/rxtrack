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

  it("keeps objective codes and microdetail fields for later attribution", () => {
    const [out] = normalizeHighYield([{
      type: "mechanism",
      term: "ALAS1",
      content: "Heme feedback inhibits expression.",
      objectiveCodes: "SOM.MK.I.BPM2.3.DM.2.BCHM.1268",
      testableDetails: ["liver"],
      exceptions: ["erythroid cells use ALAS2"],
      quantitativeDetails: ["2 ALA form PBG"],
    }]);
    expect(out).toMatchObject({
      objectiveCodes: ["SOM.MK.I.BPM2.3.DM.2.BCHM.1268"],
      testableDetails: ["liver"],
      exceptions: ["erythroid cells use ALAS2"],
      quantitativeDetails: ["2 ALA form PBG"],
    });
  });

  it("merges repeated terms so later slide qualifiers are not lost", () => {
    const [out] = normalizeHighYield([
      { type: "mechanism", term: "ALAS1", content: "Heme inhibits expression.", testableDetails: ["liver"] },
      { type: "mechanism", term: "ALAS1", content: "Barbiturates induce expression.", exceptions: ["erythroid cells use ALAS2"] },
    ]);
    expect(out.content).toContain("Barbiturates induce expression");
    expect(out.testableDetails).toContain("liver");
    expect(out.exceptions).toContain("erythroid cells use ALAS2");
  });

  it("dedupes by type+term (case-insensitive) while merging later qualifiers", () => {
    const out = normalizeHighYield([
      { type: "definition", term: "Cortisol", content: "first" },
      { type: "definition", term: "cortisol", content: "second (dupe)" },
      { type: "mechanism", term: "Cortisol", content: "different type, kept" },
    ]);
    expect(out).toHaveLength(2);
    expect(out.find((a) => a.type === "definition").content).toContain("first");
    expect(out.find((a) => a.type === "definition").content).toContain("second");
  });

  it("tolerates non-array / garbage input", () => {
    expect(normalizeHighYield(null)).toEqual([]);
    expect(normalizeHighYield({ details: [] })).toEqual([]);
    expect(normalizeHighYield([1, "x", null])).toEqual([]);
  });

  it("caps the list length", () => {
    const many = Array.from({ length: 100 }, (_, i) => ({ type: "definition", term: "t" + i, content: "c" + i }));
    expect(normalizeHighYield(many).length).toBeLessThanOrEqual(100);
  });
});
