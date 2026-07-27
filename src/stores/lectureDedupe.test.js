import { describe, expect, it } from "vitest";
import { lectureKey, pickSurvivor, planLectureDedupe, applyRelinks } from "./lectureDedupe.js";

const lec = (over) => ({ blockId: "b1", lectureType: "LEC", lectureNumber: 1, lectureTitle: "Endocrine", ...over });

describe("lectureKey", () => {
  it("keys a re-upload of the same file to the same slot", () => {
    expect(lectureKey(lec({ id: "a" }))).toBe("b1|LEC|1|endocrine");
    expect(lectureKey(lec({ id: "b", lectureNumber: "1 " }))).toBe("b1|LEC|1|endocrine");
    expect(lectureKey(lec({ id: "c", lectureTitle: null, fileName: "Endocrine.md" }))).toBe("b1|LEC|1|endocrine");
  });

  it("keeps different lectures that share a number apart", () => {
    // The real case: several distinct "LEC 1" entries in one block.
    expect(lectureKey(lec({ lectureTitle: "Population Genetics" })))
      .not.toBe(lectureKey(lec({ lectureTitle: "Population Genetics, Genotype & Allele Frequency" })));
  });

  it("keys on the title alone when there is no number", () => {
    expect(lectureKey(lec({ id: "a", lectureNumber: null }))).toBe("b1|LEC||endocrine");
  });

  it("refuses to key a lecture with no name at all", () => {
    expect(lectureKey({ id: "a", blockId: "b1" })).toBeNull();
    expect(lectureKey(lec({ id: "a", lectureTitle: "", fileName: "" }))).toBeNull();
  });

  it("keeps different numbers, types and blocks apart", () => {
    expect(lectureKey(lec({ lectureNumber: 2 }))).not.toBe(lectureKey(lec({ lectureNumber: 1 })));
    expect(lectureKey(lec({ lectureType: "DLA" }))).not.toBe(lectureKey(lec({})));
    expect(lectureKey(lec({ blockId: "b2" }))).not.toBe(lectureKey(lec({})));
  });

  it("ignores a file extension so LEC01.md and LEC01.pdf are one lecture", () => {
    expect(lectureKey(lec({ lectureTitle: null, fileName: "LEC01.pdf" })))
      .toBe(lectureKey(lec({ lectureTitle: null, fileName: "LEC01.md" })));
  });
});

describe("pickSurvivor", () => {
  const group = [
    lec({ id: "old", createdAt: "2026-07-20T04:36:00Z", chunks: [1, 2] }),
    lec({ id: "mid", createdAt: "2026-07-20T04:45:00Z", chunks: [1, 2] }),
    lec({ id: "new", createdAt: "2026-07-20T23:48:00Z", chunks: [1, 2] }),
  ];

  it("keeps the copy with the most lecture text, even when another is heavily linked", () => {
    // The real shape of this data: a linked-but-near-empty copy next to a
    // full one. Links get re-pointed; text cannot be recovered.
    expect(
      pickSurvivor(group, { links: { old: 12 }, contentSizes: { old: 617, mid: 22354, new: 0 } }).id
    ).toBe("mid");
  });

  it("then the copy with extracted atoms, then links, then recency", () => {
    const sizes = { old: 100, mid: 100, new: 100 };
    expect(pickSurvivor(group, { contentSizes: sizes, atomIds: new Set(["mid"]) }).id).toBe("mid");
    expect(pickSurvivor(group, { contentSizes: sizes, links: { old: 3 } }).id).toBe("old");
    expect(pickSurvivor(group, { contentSizes: sizes }).id).toBe("new");
  });

  it("falls back to chunk count when no sizes were surveyed", () => {
    expect(pickSurvivor([lec({ id: "thin", chunks: [] }), lec({ id: "fat", chunks: [1] })]).id).toBe("fat");
  });
});

describe("planLectureDedupe", () => {
  const lectures = [
    lec({ id: "d1", createdAt: "2026-07-20T04:36:00Z" }),
    lec({ id: "d2", createdAt: "2026-07-20T04:45:00Z" }),
    lec({ id: "d3", createdAt: "2026-07-20T23:48:00Z" }),
    lec({ id: "other", lectureNumber: 2 }),
    { id: "unkeyable" },
  ];
  const objectives = {
    b1: {
      imported: [{ id: "o1", linkedLecId: "d1" }, { id: "o2", linkedLecId: "d3" }],
      extracted: [{ id: "o3", linkedLecId: "other" }],
    },
  };

  it("names the copy whose atoms must move to the survivor", () => {
    const plan = planLectureDedupe(lectures, {
      objectives,
      atomIds: new Set(["d1"]),
      contentSizes: { d1: 100, d2: 100, d3: 9000 },
    });
    expect(plan.groups[0]).toMatchObject({ keep: "d3", carryAtomsFrom: "d1" });
  });

  it("carries nothing when the survivor already has atoms", () => {
    const plan = planLectureDedupe(lectures, { objectives, atomIds: new Set(["d3"]) });
    expect(plan.groups[0].carryAtomsFrom).toBeNull();
  });

  it("keeps one copy per slot and drops the rest", () => {
    const plan = planLectureDedupe(lectures, { objectives, atomIds: new Set(["d3"]) });

    expect(plan.groups).toHaveLength(1);
    expect(plan.groups[0]).toMatchObject({ key: "b1|LEC|1|endocrine", keep: "d3" });
    expect(plan.drop.sort()).toEqual(["d1", "d2"]);
    expect(plan.lectures.map((l) => l.id).sort()).toEqual(["d3", "other", "unkeyable"]);
  });

  it("re-points objectives off the dropped copies", () => {
    const plan = planLectureDedupe(lectures, { objectives, atomIds: new Set(["d3"]) });

    expect(plan.relink).toEqual([{ blockId: "b1", objectiveId: "o1", from: "d1", to: "d3" }]);
  });

  it("does nothing when there is nothing duplicated", () => {
    const plan = planLectureDedupe([lec({ id: "only" })], { objectives });
    expect(plan).toMatchObject({ groups: [], drop: [], relink: [] });
    expect(plan.lectures).toHaveLength(1);
  });
});

describe("applyRelinks", () => {
  it("moves only the named objectives and preserves the entry shape", () => {
    const store = {
      b1: { imported: [{ id: "o1", linkedLecId: "d1" }], extracted: [{ id: "o2", linkedLecId: "d3" }] },
      b2: [{ id: "o9", linkedLecId: "x" }],
    };
    const next = applyRelinks(store, [{ blockId: "b1", objectiveId: "o1", from: "d1", to: "d3" }]);

    expect(next.b1.imported[0]).toMatchObject({ linkedLecId: "d3", sourceFile: "d3" });
    expect(next.b1.extracted[0].linkedLecId).toBe("d3");
    expect(next.b2).toBe(store.b2);
  });

  it("returns the store untouched with nothing to relink", () => {
    const store = { b1: [] };
    expect(applyRelinks(store, [])).toBe(store);
  });
});
