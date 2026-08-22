import { describe, it, expect } from "vitest";
import { flattenWeakConcepts, groupWeakConcepts } from "./weakConcepts.js";

describe("flattenWeakConcepts", () => {
  const store = {
    "block-endo": [
      { id: "e1", concept: "Thyroid axis", blockId: "block-endo", masteryLevel: "struggling", linkedLecIds: ["lec1"] },
    ],
    "block-msk": [
      { id: "m1", concept: "Rotator cuff", blockId: "block-msk", masteryLevel: "struggling", linkedLecIds: ["lec2"] },
    ],
    lifetime: [
      { id: "e1", concept: "Thyroid axis", blockId: "block-endo", masteryLevel: "struggling", linkedLecIds: ["lec1"] },
      { id: "m1", concept: "Rotator cuff", blockId: "block-msk", masteryLevel: "struggling", linkedLecIds: ["lec2"] },
    ],
    _summary: { "block-endo": 1, "block-msk": 1 },
  };

  it("scoped to one block, does not bleed in another block's concepts via the lifetime bucket", () => {
    const out = flattenWeakConcepts(store, { blockId: "block-endo" });
    expect(out.some((c) => c.concept === "Rotator cuff")).toBe(false);
    expect(out.some((c) => c.concept === "Thyroid axis")).toBe(true);
  });

  it("everything scope (no blockId) still shows concepts from every block", () => {
    const out = flattenWeakConcepts(store, { blockId: null });
    expect(out.some((c) => c.concept === "Rotator cuff")).toBe(true);
    expect(out.some((c) => c.concept === "Thyroid axis")).toBe(true);
  });

  it("excludes lifetime entirely when asked, regardless of blockId", () => {
    const out = flattenWeakConcepts(store, { blockId: "block-endo", includeLifetime: false });
    expect(out.filter((c) => c.bucket === "lifetime")).toHaveLength(0);
  });

  it("ignores the _summary compaction bucket", () => {
    expect(flattenWeakConcepts(store, { blockId: "block-endo" }).some((c) => c.bucket === "_summary")).toBe(false);
  });
});

describe("groupWeakConcepts", () => {
  const ankiCards = [
    {
      id: "a1", concept: "Pelvic and perineal structure spatial relationships",
      angle: "anatomy", lectureLabels: ["ER Lecture-10: Introduction to the Anatomy of the Pelvis and Perineum"],
      masteryLevel: "struggling", missCount: 2, totalAttempts: 2,
    },
    {
      id: "a2", concept: "Pelvic and perineal structure spatial relationships",
      angle: "anatomy", lectureLabels: ["ER Lecture-10: Introduction to the Anatomy of the Pelvis and Perineum"],
      masteryLevel: "struggling", missCount: 3, totalAttempts: 3,
    },
    {
      id: "a3", concept: "Perineal pouch compartments and fascial layers",
      angle: "anatomy", lectureLabels: ["ER Lecture-10: Introduction to the Anatomy of the Pelvis and Perineum"],
      masteryLevel: "struggling", missCount: 1, totalAttempts: 1,
    },
    {
      id: "p1", concept: "Insulin secretion pathway",
      angle: "physiology", lectureLabels: ["Endocrine Pancreas"],
      masteryLevel: "struggling", missCount: 4, totalAttempts: 4,
    },
  ];

  it("collapses concepts sharing the same topic name and lecture into one group", () => {
    const groups = groupWeakConcepts(ankiCards);
    const pelvic = groups
      .find((g) => g.angle === "anatomy")
      ?.lectures.find((l) => l.lectureLabel.includes("Lecture-10"))
      ?.topics.find((t) => t.concept === "Pelvic and perineal structure spatial relationships");
    expect(pelvic.items).toHaveLength(2);
    expect(pelvic.missCount).toBe(5); // 2 + 3, summed
  });

  it("groups by discipline (angle) at the top level, then lecture, then topic", () => {
    const groups = groupWeakConcepts(ankiCards);
    const angles = groups.map((g) => g.angle).sort();
    expect(angles).toEqual(["anatomy", "physiology"]);
    const anatomy = groups.find((g) => g.angle === "anatomy");
    expect(anatomy.lectures).toHaveLength(1); // both anatomy topics share one lecture
    expect(anatomy.lectures[0].topics).toHaveLength(2); // two distinct topic names
  });

  it("keeps a card with no angle under a general bucket rather than dropping it", () => {
    const groups = groupWeakConcepts([{ id: "x", concept: "Mystery", missCount: 1, masteryLevel: "struggling" }]);
    expect(groups.find((g) => g.angle === "general")).toBeTruthy();
  });
});
