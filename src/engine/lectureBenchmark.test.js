import { describe, expect, it } from "vitest";
import { extractSlideObjectiveEvidence, scoreLectureAtoms, scoreQuestionUsage } from "./lectureBenchmark.js";

const gold = [
  { id: "lead", objectiveIds: ["o1"], terms: ["lead poisoning", "ALA dehydratase"], requiredDetails: [{ patterns: ["zinc"] }, { patterns: ["protoporphyrin IX"] }] },
  { id: "aip", objectiveIds: ["o2"], terms: ["acute intermittent porphyria", "HMB synthase"], requiredDetails: [{ patterns: ["no photosensitivity"] }] },
];

describe("lecture benchmark", () => {
  it("extracts slide-local objective codes with page identity", () => {
    const evidence = extractSlideObjectiveEvidence([
      { pageNumber: 12, markdown: "Lead poisoning\nSOM. MK.I.BPM2.3.DM.2.BCHM.1270" },
      { pageNumber: 13, markdown: "AIP\nSOM.MK.I.BPM2.3.DM.2.BCHM.1272" },
    ]);
    expect(evidence[0]).toMatchObject({ pageNumber: 12, codes: ["SOM.MK.I.BPM2.3.DM.2.BCHM.1270"] });
  });

  it("normalizes wrapped codes and conservatively infers a block objective when the border code is lost", () => {
    const evidence = extractSlideObjectiveEvidence([
      { pageNumber: 4, markdown: "Lead poisoning inhibits ALA dehydratase and causes microcytic anemia." },
      { pageNumber: 5, markdown: "SOM. MK.I.BPM2.3.DM.2.BCHM.1270" },
    ], [{ id: "o1", code: "SOM.MK.I.BPM2.3.DM.2.BCHM.1270", objective: "Describe ALA dehydratase and evaluate effects of lead poisoning" }]);
    expect(evidence[0]).toMatchObject({ inferred: true, codes: ["SOM.MK.I.BPM2.3.DM.2.BCHM.1270"] });
    expect(evidence[1].codes).toEqual(["SOM.MK.I.BPM2.3.DM.2.BCHM.1270"]);
  });

  it("scores both atom recall and the small details inside an atom", () => {
    const result = scoreLectureAtoms({
      atoms: [
        { term: "Lead poisoning", content: "ALA dehydratase is inhibited; zinc is involved and protoporphyrin IX accumulates." },
        { term: "Acute intermittent porphyria", content: "HMB synthase deficiency causes no photosensitivity." },
      ],
      gold,
      objectives: [{ id: "o1" }, { id: "o2" }],
    });
    expect(result.coreRecall).toBe(1);
    expect(result.detailRecall).toBe(1);
    expect(result.objectiveCoverage).toBe(1);
  });

  it("measures whether generated questions use the lecture-specific discriminator", () => {
    const result = scoreQuestionUsage({
      gold,
      questions: [
        { stem: "A patient with lead poisoning has elevated protoporphyrin IX and impaired ALA dehydratase. Which enzyme is affected?", objectiveIds: ["o1"] },
        { stem: "A patient has acute intermittent porphyria from HMB synthase deficiency but no photosensitivity. Which enzyme is deficient?", objectiveIds: ["o2"] },
      ],
    });
    expect(result.coverage).toBe(1);
    expect(result.detailUseRate).toBe(1);
  });
});
