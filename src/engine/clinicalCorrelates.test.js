import { describe, expect, it } from "vitest";
import { buildClinicalCorrelateLibrary, clinicalSignalsFromQuestion } from "./clinicalCorrelates.js";

describe("clinical correlate library", () => {
  it("keeps repeated lecture signals and cross-source lecture/homework signals", () => {
    const library = buildClinicalCorrelateLibrary({
      atoms: [
        { term: "Factor V", clinicalCorrelate: "recurrent thrombosis", clinicalCues: ["family history"] },
        { term: "Protein C", clinicalCorrelate: "recurrent thrombosis" },
      ],
      analyses: [{
        sourceKind: "homework",
        items: [{ id: "h1", clinicalCorrelates: ["recurrent thrombosis", "family history"] }],
      }],
    });

    expect(library.map((entry) => entry.label)).toEqual(expect.arrayContaining(["recurrent thrombosis", "family history"]));
    expect(library.find((entry) => entry.label === "recurrent thrombosis")).toMatchObject({
      frequency: 3,
      sourceKinds: expect.arrayContaining(["lecture", "homework"]),
    });
  });

  it("does not promote a one-off signal without recurrence or cross-source support", () => {
    const library = buildClinicalCorrelateLibrary({
      atoms: [{ term: "A", clinicalCorrelate: "single unsupported clue" }],
      examples: [{ stem: "A question with a patient", choices: { A: "one", B: "two" }, correct: "A" }],
    });
    expect(library).toEqual([]);
  });

  it("extracts conservative stem cues for uploaded questions", () => {
    expect(clinicalSignalsFromQuestion({ stem: "A 4-year-old patient presents with a family history and elevated serum level." }).cues)
      .toEqual(expect.arrayContaining(["clinical presentation", "family / inheritance clue", "laboratory clue"]));
  });
});
