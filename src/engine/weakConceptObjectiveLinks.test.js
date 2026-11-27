import { describe, expect, it } from "vitest";
import { linkWeakConceptObjectives, matchWeakConceptObjective } from "./weakConceptObjectiveLinks.js";

const objectives = [
  { id: "o1", linkedLecId: "L1", objective: "Describe the organization and composition of a somatic nerve plexus and list the nerve fiber types found in it." },
  { id: "o2", linkedLecId: "L1", objective: "Explain referred pain from convergence of visceral and somatic afferent fibers onto spinal neurons." },
  { id: "o3", linkedLecId: "L2", objective: "Identify the arterial supply of the hand, including the superficial and deep palmar arches." },
];

describe("matchWeakConceptObjective", () => {
  it("links an exact objective wording", () => {
    expect(matchWeakConceptObjective({ concept: "Describe the organization and composition of", description: objectives[0].objective }, objectives)).toMatchObject({ objectiveId: "o1", method: "exact" });
  });
  it("links a unique prefix", () => {
    expect(matchWeakConceptObjective({ concept: "Explain referred pain from convergence", description: "" }, objectives)).toMatchObject({ objectiveId: "o2", method: "prefix" });
  });
  it("links clear word overlap and refuses weak or tied matches", () => {
    expect(matchWeakConceptObjective({ concept: "Palmar arches", description: "Arterial supply of the hand: superficial and deep palmar arches" }, objectives)).toMatchObject({ objectiveId: "o3", method: "overlap" });
    expect(matchWeakConceptObjective({ concept: "Superficial palmar arch origin", description: "Which artery forms the superficial palmar arch" }, objectives)).toBeNull();
    expect(matchWeakConceptObjective({ concept: "Appendix location", description: "Primary abdominal quadrant of the appendix" }, objectives)).toBeNull();
  });
});

describe("linkWeakConceptObjectives", () => {
  const forBlock = blockId => (blockId === "b1" ? objectives : []);
  it("adds objectiveIds only to unlinked concepts, skips broad report categories, and keeps other keys", () => {
    const store = { b1: [
      { id: "c1", blockId: "b1", linkedLecIds: ["L1"], concept: "Describe the organization and composition of", description: objectives[0].objective, objectiveIds: [] },
      { id: "c2", blockId: "b1", linkedLecIds: ["L1"], concept: "Something", objectiveIds: ["kept"] },
      { id: "c3", blockId: "b1", linkedLecIds: ["L1"], concept: "Organ structure", tags: ["exam-report"], objectiveIds: [] },
      { id: "c4", blockId: "b1", linkedLecIds: ["L2"], concept: "Appendix location", description: "quadrant" },
    ], lifetime: { n: 1 } };
    const next = linkWeakConceptObjectives(store, forBlock, { now: 5 });
    expect(next.b1[0]).toMatchObject({ objectiveIds: ["o1"], objectiveLink: { method: "exact", at: 5 } });
    expect(next.b1[1]).toBe(store.b1[1]);
    expect(next.b1[2]).toBe(store.b1[2]);
    expect(next.b1[3]).toMatchObject({ objectiveLink: { method: "none" } });
    expect(next.b1[3].objectiveIds).toBeUndefined();
    expect(next.lifetime).toBe(store.lifetime);
    expect(linkWeakConceptObjectives(next, forBlock)).toBe(next);
  });
  it("waits when the block's objectives have not loaded", () => {
    const store = { b2: [{ id: "c", blockId: "b2", linkedLecIds: ["Lx"], concept: "x" }] };
    expect(linkWeakConceptObjectives(store, () => [])).toBe(store);
  });
});
