import { describe, expect, it } from "vitest";
import { schoolEmphasisCounts, withSchoolEmphasis } from "./schoolEmphasis.js";
import { sortWeakestFirst } from "../shell/features/objectives/quizLaunch.js";

const objective = (id, code, text, status = "untested") => ({ id, code, objective: text, status });
const school = (code, extra = {}) => ({
  sourceFile: "ESoftQuiz4-NB2.pdf", stem: `A patient presents with findings. Which structure is involved?`,
  choices: { A: "One", B: "Two", C: "Three", D: "Four", E: "Five" }, correct: "A",
  answerKeyVerified: true, schoolObjectiveCode: code, ...extra,
});

describe("schoolEmphasisCounts", () => {
  const objectives = [
    objective("o1", "SOM.MK.IV.BPM2.4.NB.2.NSCI.0159", "Describe decorticate rigidity"),
    objective("o2", "SOM.MK.IV.BPM2.4.NB.2.NSCI.0160", "Describe decerebrate rigidity"),
  ];

  it("counts school questions tied to an objective by exact code", () => {
    const counts = schoolEmphasisCounts([school(objectives[0].code), school(objectives[0].code), school(objectives[1].code)], objectives);
    expect(counts.get("o1")).toBe(2);
    expect(counts.get("o2")).toBe(1);
  });

  it("counts stored objective links but ignores loose word overlap", () => {
    const linked = school(null, { objectiveIds: ["o2"], stem: "Describe decorticate rigidity posture findings in a patient. Which tract?" });
    const counts = schoolEmphasisCounts([linked], objectives);
    expect(counts.get("o2")).toBe(1);
    expect(counts.get("o1") || 0).toBe(0);
  });

  it("ignores clicker items and items with an unverified key", () => {
    const counts = schoolEmphasisCounts([
      school(objectives[0].code, { sourceFile: "Week 9 clicker questions.pdf" }),
      school(objectives[0].code, { answerKeyVerified: false }),
    ], objectives);
    expect(counts.get("o1") || 0).toBe(0);
  });
});

describe("school emphasis in objective ordering", () => {
  it("breaks ties within the same status by school emphasis, never across statuses", () => {
    const objectives = [
      objective("low", "SOM.A.NSCI.0001", "Low emphasis", "untested"),
      objective("high", "SOM.A.NSCI.0002", "High emphasis", "untested"),
      objective("weak", "SOM.A.NSCI.0003", "Weak", "struggling"),
    ];
    const ranked = withSchoolEmphasis(objectives, [school("SOM.A.NSCI.0002"), school("SOM.A.NSCI.0002")]);
    expect(ranked.find(o => o.id === "high")._schoolEmphasis).toBe(2);
    expect(sortWeakestFirst(ranked).map(o => o.id)).toEqual(["weak", "high", "low"]);
  });

  it("leaves objectives untouched when there are no school examples", () => {
    const objectives = [objective("a", "X.1", "A")];
    expect(withSchoolEmphasis(objectives, [])).toEqual(objectives);
  });
});
