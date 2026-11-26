import { describe, expect, it } from "vitest";
import { bankFormat, bankMappingScope, schoolWeekKey } from "./bankMappingScope.js";
import { candidateBlocks, relinkCandidates } from "./relinkQuestionBanks.js";

const lec = (id, blockId, lectureTitle, lectureDate, text) => ({ id, blockId, lectureTitle, lectureDate, termId: "t2", chunks: [{ text }] });
const LECTURES = [
  lec("a1", "nb2", "NB 40 Cerebellum", "2026-11-02", "cerebellum ataxia dysmetria intention tremor vermis purkinje"),
  lec("a2", "nb2", "NB 41 Basal ganglia", "2026-11-03", "basal ganglia parkinson rigidity bradykinesia substantia nigra dopamine"),
  lec("b1", "nb3", "NB 59 Depressive disorders", "2026-11-18", "depression anhedonia guilt suicidal ideation sertraline"),
  lec("b2", "nb3", "NB 66 Schizophrenia", "2026-11-25", "schizophrenia hallucinations delusions haloperidol"),
  lec("b3", "nb3", "NB 60 Bipolar disorder", "2026-11-19", "bipolar mania lithium grandiosity"),
];
const q = stem => ({ stem, correct: "A", choices: { A: "x", B: "y" } });

describe("bankMappingScope", () => {
  it("reads the school format from the filename", () => {
    expect(bankFormat("BPM2 ESOFT QUIZ 5")).toBe("esoft");
    expect(bankFormat("NB IMCQ KEY 05")).toBe("imcq");
    expect(bankFormat("Week 15 NB BEHS Practice Questions")).toBe("homework");
  });

  it("homes a CBSE-filed IMCQ in the block and week that taught it", () => {
    const questions = [q("Anhedonia and guilt with suicidal ideation; depression treated with sertraline"), q("Depression with anhedonia and guilt"), q("Bipolar mania treated with lithium"), q("Mania and grandiosity; lithium for bipolar")];
    const scope = bankMappingScope({ filename: "NB IMCQ 9", bankBlockId: "cbse-prep", questions, lectures: LECTURES });
    expect(scope.homeBlockId).toBe("nb3");
    expect(scope.focusWeeks).toEqual([schoolWeekKey(LECTURES[2])]);
    expect(scope.focusLectureIds.sort()).toEqual(["b1", "b3"]);
  });

  it("keeps the filed block unless another block clearly taught the bank", () => {
    const questions = [q("Cerebellum ataxia with intention tremor"), q("Parkinson rigidity and bradykinesia from substantia nigra loss"), q("Depression with anhedonia")];
    expect(bankMappingScope({ filename: "NB IMCQ 5", bankBlockId: "nb2", questions, lectures: LECTURES }).homeBlockId).toBe("nb2");
  });

  it("finds candidate banks and term blocks", () => {
    expect(candidateBlocks([...LECTURES, { id: "x", blockId: "cbse-prep" }, { id: "t1", blockId: "msk", termId: "t1", lectureDate: "2026-01-01" }], "cbse-prep").sort()).toEqual(["nb2", "nb3"]);
    expect(relinkCandidates({ m: { filename: "f", blockId: "b" }, n: { filename: "empty", blockId: "b" } }, { f: [{ correct: "A" }], empty: [] }).map(job => job.filename)).toEqual(["f"]);
  });
});
