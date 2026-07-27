import { describe, expect, it, vi } from "vitest";
import {
  objectiveText,
  matchByTerm,
  buildTagPrompt,
  applyTags,
  tagAtomsWithObjectives,
  atomsPerObjective,
} from "./tagAtoms.js";

const atom = (over) => ({ type: "definition", term: "Adenohypophysis", content: "Anterior pituitary.", ...over });
const objectives = [
  { id: "o1", code: "ER.01", objective: "Describe the histology of the adenohypophysis." },
  { id: "o2", code: "ER.02", text: "Explain oxytocin release from the posterior pituitary." },
  { id: "o3", objective: "" },
];

describe("matchByTerm", () => {
  it("matches an objective that contains the atom's term", () => {
    expect(matchByTerm(atom(), objectives)).toEqual(["o1"]);
  });

  it("ignores punctuation and case", () => {
    expect(matchByTerm(atom({ term: "ADENOHYPOPHYSIS!" }), objectives)).toEqual(["o1"]);
  });

  it("refuses to match on a term too short to mean anything", () => {
    expect(matchByTerm(atom({ term: "ADH" }), objectives)).toEqual([]);
    expect(matchByTerm(atom({ term: "" }), objectives)).toEqual([]);
  });

  it("returns nothing when no objective mentions the term", () => {
    expect(matchByTerm(atom({ term: "Herring bodies" }), objectives)).toEqual([]);
  });
});

describe("buildTagPrompt", () => {
  it("numbers both lists and shows objective codes", () => {
    const prompt = buildTagPrompt([atom()], objectives.slice(0, 2));
    expect(prompt).toContain("1. [ER.01] Describe the histology of the adenohypophysis.");
    expect(prompt).toContain("2. [ER.02] Explain oxytocin release");
    expect(prompt).toContain("1. [definition] Adenohypophysis: Anterior pituitary.");
  });
});

describe("applyTags", () => {
  const atoms = [atom({ term: "A" }), atom({ term: "B" })];

  it("maps 1-based model output onto atoms", () => {
    const tagged = applyTags(atoms, objectives, { tags: [{ fact: 2, objectives: [1, 2] }] });
    expect(tagged[0].objectiveIds).toEqual([]);
    expect(tagged[1].objectiveIds).toEqual(["o1", "o2"]);
  });

  it("drops out-of-range and duplicate references", () => {
    const tagged = applyTags(atoms, objectives, {
      tags: [{ fact: 1, objectives: [1, 1, 99, 0] }, { fact: 47, objectives: [1] }],
    });
    expect(tagged[0].objectiveIds).toEqual(["o1"]);
  });

  it("survives junk output", () => {
    expect(applyTags(atoms, objectives, null)[0].objectiveIds).toEqual([]);
    expect(applyTags(atoms, objectives, { tags: "nope" })[1].objectiveIds).toEqual([]);
  });
});

describe("tagAtomsWithObjectives", () => {
  it("uses the free term match and only asks the model about the rest", async () => {
    const callAIJSON = vi.fn().mockResolvedValue({ tags: [{ fact: 1, objectives: [2] }] });
    const atoms = [atom(), atom({ term: "Herring bodies", content: "Store oxytocin." })];

    const result = await tagAtomsWithObjectives(atoms, objectives, { callAIJSON });

    expect(result.byTerm).toBe(1);
    expect(result.tagged).toBe(2);
    expect(result.atoms[0].objectiveIds).toEqual(["o1"]);
    expect(result.atoms[1].objectiveIds).toEqual(["o2"]);
    // Only the untagged atom was sent.
    expect(callAIJSON.mock.calls[0][1]).toContain("Herring bodies");
    expect(callAIJSON.mock.calls[0][1]).not.toContain("1. [definition] Adenohypophysis");
  });

  it("skips the model entirely when the term match covers everything", async () => {
    const callAIJSON = vi.fn();
    const result = await tagAtomsWithObjectives([atom()], objectives, { callAIJSON });
    expect(callAIJSON).not.toHaveBeenCalled();
    expect(result.tagged).toBe(1);
  });

  it("keeps the free matches when the model call fails", async () => {
    const callAIJSON = vi.fn().mockRejectedValue(new Error("model down"));
    const result = await tagAtomsWithObjectives([atom(), atom({ term: "Herring bodies" })], objectives, { callAIJSON });

    expect(result.error).toBe("model down");
    expect(result.atoms[0].objectiveIds).toEqual(["o1"]);
    expect(result.atoms[1].objectiveIds).toEqual([]);
  });

  it("says so when there is nothing to work with", async () => {
    expect((await tagAtomsWithObjectives([], objectives, {})).error).toMatch(/No atoms/);
    expect((await tagAtomsWithObjectives([atom()], [], {})).error).toMatch(/no objectives/);
  });
});

describe("atomsPerObjective", () => {
  it("counts how many atoms teach each objective", () => {
    expect(
      atomsPerObjective([
        { objectiveIds: ["o1", "o2"] },
        { objectiveIds: ["o1"] },
        { objectiveIds: [] },
        {},
      ])
    ).toEqual({ o1: 2, o2: 1 });
  });
});

describe("objectiveText", () => {
  it("reads either field", () => {
    expect(objectiveText({ objective: "a" })).toBe("a");
    expect(objectiveText({ text: "b" })).toBe("b");
    expect(objectiveText(null)).toBe("");
  });
});
