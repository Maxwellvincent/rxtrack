import { describe, expect, it } from "vitest";
import { matchTopicObjectives, topicFocusNotes } from "./topicFocus.js";

const lectures = [
  { id: "bs", blockId: "nb2", lectureTitle: "NB 40 Brainstem Lesions and Blood Supply", atoms: [
    { term: "Lateral medullary syndrome", content: "Occlusion of the posterior inferior cerebellar artery causes Wallenberg syndrome.", objectiveIds: ["o2"] },
    { term: "Medial medullary syndrome", content: "Anterior spinal artery occlusion damages the pyramid, medial lemniscus and CN XII.", objectiveIds: ["o1"] },
  ] },
  { id: "cb", blockId: "nb2", lectureTitle: "NB 41 Cerebellum", atoms: [{ term: "AICA", content: "Anterior inferior cerebellar artery supplies the lateral pons.", objectiveIds: ["o3"] }] },
  { id: "other", blockId: "nb3", lectureTitle: "NB 59 Depression", atoms: [] },
];
const objectives = [
  { id: "o1", linkedLecId: "bs", objective: "Describe the deficits of medial medullary lesions" },
  { id: "o2", linkedLecId: "bs", objective: "Localize lateral brainstem vascular lesions" },
  { id: "o3", linkedLecId: "cb", objective: "Relate cerebellar blood supply to clinical deficits" },
  { id: "o4", linkedLecId: "other", objective: "Apply diagnostic criteria for depressive disorders" },
];

describe("matchTopicObjectives", () => {
  it("finds the objectives a topic covers inside the block, expanding PICA and AICA", () => {
    const result = matchTopicObjectives("PICA vs AICA lesions, medial medulla", { blockId: "nb2", lectures, objectives });
    expect(result.objectives.map(row => row.id).sort()).toEqual(["o1", "o2", "o3"]);
    expect(result.lectures.map(row => row.id).sort()).toEqual(["bs", "cb"]);
    expect(result.objectives.every(row => row.reasons.length > 0)).toBe(true);
  });

  it("never reaches into another block and returns nothing for an unrelated topic", () => {
    expect(matchTopicObjectives("depressive disorders", { blockId: "nb2", lectures, objectives }).objectives).toEqual([]);
    expect(matchTopicObjectives("  ", { blockId: "nb2", lectures, objectives }).objectives).toEqual([]);
  });
});

describe("topicFocusNotes", () => {
  it("asks for repair-first progression and look-alike contrasts on the topic", () => {
    const notes = topicFocusNotes("PICA vs AICA lesions");
    expect(notes).toMatch(/PICA vs AICA lesions/);
    expect(notes).toMatch(/look-alike/i);
  });
});
