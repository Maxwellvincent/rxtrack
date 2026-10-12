import { describe, expect, it } from "vitest";
import { buildClinicalCorrelateLibrary, buildClinicalCorrelatePlan, clinicalSignalsFromQuestion, curatedClinicalCorrelatesForLecture } from "./clinicalCorrelates.js";

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

  it("loads the complete lecture-explicit NB1 inventory only for the matching lecture", () => {
    const hemorrhageLecture = curatedClinicalCorrelatesForLecture({ lectureTitle: "NB1 Lecture 04 - Meninges and Arteries" });
    expect(hemorrhageLecture.map((entry) => entry.label)).toEqual(expect.arrayContaining([
      "Epidural hemorrhage",
      "Subdural hemorrhage",
      "Subarachnoid hemorrhage",
      "Intracerebral hemorrhage",
    ]));
    expect(hemorrhageLecture.every((entry) => entry.sourcePage.startsWith("L04"))).toBe(true);
    expect(curatedClinicalCorrelatesForLecture({ lectureTitle: "Biochemistry of Glycolysis" })).toEqual([]);
  });

  it("keeps all 136 parsed explicit correlates addressable across NB1 lectures", () => {
    const titles = ["DLA - Practical Clinical Neuroimaging", ...Array.from({ length: 22 }, (_, index) => `Lecture ${String(index + 1).padStart(2, "0")}`)];
    const all = titles.flatMap((lectureTitle) => curatedClinicalCorrelatesForLecture({ lectureTitle, max: 100 }));
    expect(new Set(all.map((entry) => entry.id)).size).toBe(136);
    expect(all.every((entry) => entry.recognitionCue && entry.structureMechanism && entry.discriminator && entry.sourcePage)).toBe(true);
  });

  it("reserves forty percent of a batch for rotating recognition, mechanism, and discrimination practice", () => {
    const library = buildClinicalCorrelateLibrary({ lectureTitle: "Lecture 20 - Histology of the Eye" });
    const first = buildClinicalCorrelatePlan(library, 10, 0);
    const rotated = buildClinicalCorrelatePlan(library, 10, 3);
    expect(first.targetCount).toBe(4);
    expect(first.targets.map((target) => target.stage)).toEqual(["recognition", "mechanism", "discrimination", "recognition"]);
    expect(rotated.targets[0].id).not.toBe(first.targets[0].id);
  });
});
