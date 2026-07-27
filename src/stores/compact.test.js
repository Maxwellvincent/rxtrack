import { describe, expect, it } from "vitest";
import { compactObjective, compactObjectivesStore, findKeeperFor, isRedundantBlock } from "./compact.js";
import { guideFor, OBJECTIVE_GUIDES } from "../objectiveGuides.js";

const objective = (over = {}) => ({
  id: "o1",
  bloom_level: 2,
  objective: "Describe the brachial plexus.",
  text: "Describe the brachial plexus.",
  status: "untested",
  quizScore: null,
  lastTested: "",
  sg_guide: OBJECTIVE_GUIDES.sg_guide[2],
  dla_guide: OBJECTIVE_GUIDES.dla_guide[2],
  pre_lecture_guide: OBJECTIVE_GUIDES.pre_lecture_guide[2],
  post_lecture_guide: OBJECTIVE_GUIDES.post_lecture_guide[2],
  ...over,
});

describe("compactObjective", () => {
  it("drops the duplicate text, empty fields, and default guides", () => {
    expect(compactObjective(objective())).toEqual({
      id: "o1",
      bloom_level: 2,
      objective: "Describe the brachial plexus.",
      status: "untested",
    });
  });

  it("reads back identically through guideFor", () => {
    const before = objective();
    const after = compactObjective(before);
    for (const field of ["sg_guide", "dla_guide", "pre_lecture_guide", "post_lecture_guide"]) {
      expect(guideFor(after, field)).toBe(before[field]);
    }
    expect(after.objective || after.text).toBe(before.objective);
  });

  it("keeps a guide that is not the Bloom-level default", () => {
    const custom = objective({ sg_guide: "Ask the professor about this one." });
    expect(compactObjective(custom).sg_guide).toBe("Ask the professor about this one.");
  });

  it("keeps text that says something different from objective", () => {
    const differing = objective({ text: "Also: name the cords." });
    expect(compactObjective(differing).text).toBe("Also: name the cords.");
  });

  it("keeps guides on an objective with no bloom level", () => {
    const noBloom = objective({ bloom_level: undefined });
    expect(compactObjective(noBloom).sg_guide).toBe(OBJECTIVE_GUIDES.sg_guide[2]);
  });
});

describe("compactObjectivesStore", () => {
  const store = () => ({
    b1: { imported: [objective()], extracted: [objective({ id: "o2" })] },
    b2: [objective({ id: "o3" })],
    stale: [objective({ id: "o1" }), objective({ id: "o2" })],
  });

  it("preserves each block's storage shape and reports the saving", () => {
    const { next, stats } = compactObjectivesStore(store());

    expect(Object.keys(next.b1)).toEqual(["imported", "extracted"]);
    expect(Array.isArray(next.b2)).toBe(true);
    expect(stats.after).toBeLessThan(stats.before);
    expect(stats.saved).toBe(stats.before - stats.after);
    expect(stats.dropped).toEqual([]);
  });

  it("drops only the blocks it is told to, and says what it dropped", () => {
    const { next, stats } = compactObjectivesStore(store(), { dropBlocks: ["stale"] });

    expect(Object.keys(next)).toEqual(["b1", "b2"]);
    expect(stats.dropped).toHaveLength(1);
    expect(stats.dropped[0].blockId).toBe("stale");
    expect(stats.dropped[0].bytes).toBeGreaterThan(0);
  });

  it("handles an empty store", () => {
    expect(compactObjectivesStore({}).next).toEqual({});
  });
});

describe("isRedundantBlock", () => {
  it("is true for a full copy carrying no progress", () => {
    const store = {
      live: { imported: [{ id: "a" }, { id: "b" }] },
      copy: [{ id: "a" }, { id: "b", status: "untested" }],
    };
    expect(isRedundantBlock(store, "copy", "live")).toBe(true);
  });

  it("is false once the copy holds progress of its own", () => {
    const store = {
      live: [{ id: "a" }],
      copy: [{ id: "a", status: "mastered" }],
    };
    expect(isRedundantBlock(store, "copy", "live")).toBe(false);
    expect(isRedundantBlock({ live: [{ id: "a" }], copy: [{ id: "a", linkedLecId: "lec1" }] }, "copy", "live")).toBe(false);
  });

  it("is false when the keeper does not cover every id", () => {
    expect(isRedundantBlock({ live: [{ id: "a" }], copy: [{ id: "a" }, { id: "z" }] }, "copy", "live")).toBe(false);
    expect(isRedundantBlock({ live: [], copy: [{ id: "a" }] }, "copy", "live")).toBe(false);
  });
});

describe("findKeeperFor", () => {
  it("prefers the block whose id set matches exactly", () => {
    // Ids are not block-scoped here: `wide` covers the copy but holds more.
    const store = {
      wide: [{ id: "a" }, { id: "b" }, { id: "c" }],
      twin: [{ id: "a" }, { id: "b" }],
      copy: [{ id: "a" }, { id: "b" }],
    };
    const result = findKeeperFor(store, "copy");
    expect(result).toMatchObject({ keeper: "twin", exact: true });
    expect(result.candidates.sort()).toEqual(["twin", "wide"]);
  });

  it("falls back to a covering superset when nothing matches exactly", () => {
    const store = { wide: [{ id: "a" }, { id: "b" }], copy: [{ id: "a" }] };
    expect(findKeeperFor(store, "copy")).toMatchObject({ keeper: "wide", exact: false });
  });

  it("refuses a block that holds progress, or that nothing covers", () => {
    expect(findKeeperFor({ live: [{ id: "a" }], copy: [{ id: "a", status: "mastered" }] }, "copy").keeper).toBeNull();
    expect(findKeeperFor({ live: [{ id: "a" }], copy: [{ id: "z" }] }, "copy").keeper).toBeNull();
    expect(findKeeperFor({ copy: [] }, "copy").keeper).toBeNull();
  });
});
