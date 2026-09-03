import { describe, expect, it } from "vitest";
import { canonicalObjectiveCode, reconcileOfficialObjectives } from "./objectiveImport.js";

const incoming = (id, code, objective, linkedLecId = "lec1") => ({
  id, code, objectiveCode: code, objective, text: objective, linkedLecId,
  extractionMethod: "standalone-doc", status: "untested",
});

describe("official objective reconciliation", () => {
  it("repairs malformed rows while preserving learning evidence and ids", () => {
    const old = {
      ...incoming("old-id", "SOM.DM.1001SOM.DM.1002", "Describe metabolism. 669241 Objectives : Lectures 1 & 2", "wrong"),
      status: "mastered", attempts: 4, correctCount: 3,
    };
    const clean = incoming("new-id", "SOM.DM.1001", "Describe metabolism.");
    const result = reconcileOfficialObjectives([old], [clean]);
    expect(result).toMatchObject({ added: 0, updated: 1, removed: 0 });
    expect(result.objectives[0]).toMatchObject({
      id: "old-id", code: "SOM.DM.1001", objective: "Describe metabolism.",
      linkedLecId: "lec1", status: "mastered", attempts: 4, correctCount: 3,
    });
  });

  it("removes stale coded rows even when an early import omitted provenance", () => {
    const stale = incoming("stale", "SOM.DM.9999", "Old malformed objective.");
    const lecture = { ...incoming("lecture", "SOM.DM.8888", "Lecture objective."), extractionMethod: "table" };
    const clean = incoming("clean", "SOM.DM.1001", "Describe metabolism.");
    const result = reconcileOfficialObjectives([stale, lecture], [clean]);
    expect(result).toMatchObject({ added: 1, updated: 0, removed: 2 });
    expect(result.objectives.map((row) => row.id)).toEqual(["clean"]);
  });

  it("keeps uncoded lecture and manual objectives outside the authoritative coded set", () => {
    const lecture = { id: "lecture", objective: "Describe a lecture-only detail.", text: "Describe a lecture-only detail.", extractionMethod: "table" };
    const clean = incoming("clean", "SOM.DM.1001", "Describe metabolism.");
    const result = reconcileOfficialObjectives([lecture], [clean]);
    expect(result.objectives.map((row) => row.id)).toEqual(["lecture", "clean"]);
  });

  it("extracts only the first valid code from previously joined codes", () => {
    expect(canonicalObjectiveCode({ code: "SOM.DM.1001SOM.DM.1002" })).toBe("SOM.DM.1001");
  });

  it("collapses duplicate legacy rows and keeps the strongest learning evidence", () => {
    const weak = { ...incoming("weak", "SOM.DM.1001", "Old wording."), status: "untested" };
    const learned = { ...incoming("learned", "SOM.DM.1001", "Old wording."), status: "mastered", attempts: 5 };
    const clean = incoming("clean", "SOM.DM.1001", "Describe metabolism.");
    const result = reconcileOfficialObjectives([weak, learned], [clean]);
    expect(result).toMatchObject({ added: 0, updated: 1, removed: 1 });
    expect(result.objectives).toHaveLength(1);
    expect(result.objectives[0]).toMatchObject({ id: "learned", status: "mastered", attempts: 5, objective: "Describe metabolism." });
  });
});
