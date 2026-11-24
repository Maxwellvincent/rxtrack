import { describe, expect, it } from "vitest";
import { blockHighYield, objectiveTaskKind } from "./blockHighYield.js";

const lectures = [
  { id: "nb56", blockId: "b", lectureNumber: 56, lectureType: "LEC", lectureTitle: "NB 56 Anxiety Disorders" },
  { id: "nb61", blockId: "b", lectureNumber: 61, lectureType: "LEC", lectureTitle: "NB 61 Sleep" },
  { id: "other", blockId: "x", lectureTitle: "Other block" },
];
const objectives = [
  { id: "o56a", blockId: "b", linkedLecId: "nb56", code: "SOM.A.0001", objective: "Apply the essential diagnostic criteria for anxiety disorders", status: "untested" },
  { id: "o56b", blockId: "b", linkedLecId: "nb56", code: "SOM.A.0002", objective: "Describe the management of anxiety disorders, including mechanisms of action and side effects", status: "struggling" },
  { id: "o61", blockId: "b", linkedLecId: "nb61", code: "SOM.A.0003", objective: "Contrast sleep stages through the use of electroencephalography", status: "mastered" },
];
const q = (extra) => ({ stem: "A patient presents. Which diagnosis?", correct: "A", choices: { A: "x", B: "y" }, ...extra });
const banks = {
  "Week 15 NB BEHS Practice Questions": [q({ objectiveIds: ["o56a"], lectureId: "nb56" }), q({ objectiveIds: ["o56a"], lectureId: "nb56" }), q({ lectureId: "nb61" }), q({})],
  "BPM2 ESOFT QUIZ9 F2026": [q({ schoolObjectiveCode: "SOM.A.0003" })],
  "Week 16 clicker questions": [q({ objectiveIds: ["o61"] })],
};
const meta = { m1: { filename: "Week 15 NB BEHS Practice Questions", blockId: "b" }, m2: { filename: "BPM2 ESOFT QUIZ9 F2026", blockId: "b" }, m3: { filename: "Week 16 clicker questions", blockId: "b", sourceKind: "clicker" } };
const weak = { b: [{ concept: "Anxiety disorders", tags: ["exam-report"], linkedLecIds: ["nb56"], reportScore: 55, reportSampleSize: 9 }] };

describe("blockHighYield", () => {
  const result = blockHighYield({ blockId: "b", lectures, objectives, banks, bankMeta: meta, weakConcepts: weak });

  it("counts school questions per objective with source weights and ignores clickers", () => {
    const o56a = result.objectives.find(row => row.id === "o56a");
    expect(o56a).toMatchObject({ counts: { homework: 2 }, schoolScore: 2 });
    const o61 = result.objectives.find(row => row.id === "o61");
    expect(o61).toMatchObject({ counts: { esoft: 1 }, schoolScore: 3 });
  });

  it("ranks lectures by school emphasis plus report weakness and unfinished objectives", () => {
    expect(result.lectures.map(row => row.lectureId)).toEqual(["nb56", "nb61"]);
    const nb56 = result.lectures[0];
    expect(nb56).toMatchObject({ questionCount: 2, reportWeak: true, untested: 1, struggling: 1 });
    expect(nb56.reasons.join(" ")).toMatch(/score report/i);
  });

  it("summarizes what the school asks you to do", () => {
    expect(result.taskKinds.slice(0, 2)).toEqual([
      { kind: "differentiate", objectives: 1, schoolScore: 3 },
      { kind: "diagnostic criteria", objectives: 1, schoolScore: 2 },
    ]);
    expect(objectiveTaskKind("Clinically differentiate the sleep-wake disorders")).toBe("differentiate");
  });

  it("reports how much of the evidence is still unlinked", () => {
    expect(result.coverage).toMatchObject({ schoolQuestions: 5, linkedToObjective: 3, unlinked: 1 });
  });
});
