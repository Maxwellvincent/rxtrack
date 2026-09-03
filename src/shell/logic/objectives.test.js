import { describe, expect, it, vi } from "vitest";
import {
  readEntry,
  storageKeyFor,
  flattenEntry,
  dedupeById,
  toEntry,
  dedupeByText,
  selectBlockObjectives,
  updateObjective,
  setStatus,
  selfRate,
  recordObjectiveAttempt,
  assignToLecture,
  assignManyToLecture,
  removeLectureLink,
  deleteObjectives,
  isLinked,
  deleteUnlinked,
  replaceLectureObjectives,
  statusCounts,
  coveragePct,
  bloomRollup,
  alignmentStats,
  createObjectiveCommands,
} from "./objectives.js";

const NOW = "2026-07-25T00:00:00.000Z";
const objs = (...ids) => ids.map((id) => ({ id }));

describe("storage shape", () => {
  it("reads a block entry and falls back to the legacy msk slot only for msk", () => {
    expect(readEntry({ b1: [{ id: "o1" }] }, "b1")).toEqual([{ id: "o1" }]);
    expect(readEntry({ msk: [{ id: "o1" }] }, "msk")).toEqual([{ id: "o1" }]);
    expect(readEntry({ msk: [{ id: "o1" }] }, "b1")).toBeNull();
    expect(readEntry(null, "b1")).toBeNull();
    expect(readEntry({ b1: [] }, "")).toBeNull();
  });

  it("writes back to the slot the data already lives in", () => {
    expect(storageKeyFor({ msk: [] }, "msk")).toBe("msk");
    expect(storageKeyFor({ b1: [] }, "b1")).toBe("b1");
    expect(storageKeyFor({}, "b1")).toBe("b1");
  });

  it("flattens every historical entry shape", () => {
    expect(flattenEntry([{ id: "o1" }])).toEqual([{ id: "o1" }]);
    expect(flattenEntry({ imported: [{ id: "o1" }], extracted: [{ id: "o2" }] }))
      .toEqual([{ id: "o1" }, { id: "o2" }]);
    expect(flattenEntry({ 0: { id: "o1" }, 1: { id: "o2" } })).toEqual([{ id: "o1" }, { id: "o2" }]);
    expect(flattenEntry(null)).toEqual([]);
    expect(flattenEntry({})).toEqual([]);
  });

  it("dedupes by id but keeps id-less rows", () => {
    expect(dedupeById([{ id: "a", v: 1 }, { id: "a", v: 2 }, { id: "b" }]))
      .toEqual([{ id: "a", v: 1 }, { id: "b" }]);
    expect(dedupeById([{ note: "x" }, { note: "y" }])).toHaveLength(2);
    expect(dedupeById([null, "nope", { id: "a" }])).toEqual([{ id: "a" }]);
  });

  it("preserves imported/extracted buckets and routes new items to extracted", () => {
    const existing = { imported: [{ id: "i1" }], extracted: [{ id: "e1" }], meta: "keep" };
    expect(toEntry(existing, [{ id: "i1", v: 2 }, { id: "e1" }, { id: "new" }])).toEqual({
      meta: "keep",
      imported: [{ id: "i1", v: 2 }],
      extracted: [{ id: "e1" }, { id: "new" }],
    });
  });

  it("keeps a legacy flat array flat", () => {
    expect(toEntry([{ id: "o1" }], [{ id: "o1" }, { id: "o2" }])).toEqual([{ id: "o1" }, { id: "o2" }]);
  });

  it("dedupes the display list by objective text and drops text-less rows", () => {
    expect(
      dedupeByText([
        { id: "a", objective: "Describe the brachial plexus." },
        { id: "b", objective: "describe the BRACHIAL plexus!" },
        { id: "c", text: "Name the rotator cuff muscles." },
        { id: "d" },
      ]).map((o) => o.id)
    ).toEqual(["a", "c"]);
  });

  it("keeps identical official wording when the SOM codes differ", () => {
    expect(dedupeByText([
      { id: "a", code: "SOM.DM.1001", objective: "Describe metabolism." },
      { id: "b", code: "SOM.DM.1002", objective: "Describe metabolism." },
    ])).toHaveLength(2);
  });

  it("selects a block's flat list off a store map", () => {
    expect(selectBlockObjectives({ b1: { imported: [{ id: "o1" }], extracted: [] } }, "b1"))
      .toEqual([{ id: "o1" }]);
  });
});

describe("reducers", () => {
  it("patches by id and leaves an unknown id untouched", () => {
    expect(updateObjective(objs("a", "b"), "b", { status: "mastered" }))
      .toEqual([{ id: "a" }, { id: "b", status: "mastered" }]);
    const list = objs("a");
    expect(updateObjective(list, "missing", { status: "x" })).toBe(list);
  });

  it("stamps status changes the way App did", () => {
    expect(setStatus(objs("a"), "a", "mastered", NOW)[0])
      .toEqual({ id: "a", status: "mastered", lastUpdated: NOW, lastTested: NOW });
    expect(setStatus(objs("a"), "a", "mastered", NOW, { includeLastDrilled: true })[0].lastDrilled).toBe(NOW);
    expect(selfRate(objs("a"), "a", "struggling", NOW)[0])
      .toEqual({ id: "a", status: "struggling", lastTested: NOW });
  });

  it("syncs objective mastery evidence on every linked question answer", () => {
    const start = [{ id: "a", status: "untested", consecutiveCorrect: 0 }];
    const first = recordObjectiveAttempt(start, "a", true, NOW);
    expect(first[0]).toMatchObject({ status: "inprogress", attempts: 1, correctCount: 1, consecutiveCorrect: 1 });
    const second = recordObjectiveAttempt(first, "a", true, NOW);
    expect(second[0]).toMatchObject({ status: "mastered", attempts: 2, correctCount: 2, consecutiveCorrect: 2 });
    const missed = recordObjectiveAttempt(second, "a", false, NOW);
    expect(missed[0]).toMatchObject({ status: "struggling", attempts: 3, consecutiveCorrect: 0 });
  });

  it("assigns and unassigns lectures", () => {
    expect(assignToLecture(objs("a"), "a", "lec1", NOW)[0]).toEqual({
      id: "a", linkedLecId: "lec1", sourceFile: "lec1", manuallyAligned: true, alignedAt: NOW,
    });
    expect(assignManyToLecture(objs("a", "b"), ["a"], "lec1")).toEqual([
      { id: "a", linkedLecId: "lec1", sourceFile: "lec1", manuallyAligned: true },
      { id: "b" },
    ]);
    const linked = assignToLecture(objs("a"), "a", "lec1", NOW);
    expect(removeLectureLink(linked, "a")[0]).toMatchObject({ linkedLecId: null, sourceFile: null });
  });

  it("ignores incomplete assign arguments", () => {
    const list = objs("a");
    expect(assignToLecture(list, "a", null, NOW)).toBe(list);
    expect(assignManyToLecture(list, [], "lec1")).toBe(list);
    expect(deleteObjectives(list, [])).toBe(list);
  });

  it("deletes by id", () => {
    expect(deleteObjectives(objs("a", "b", "c"), ["a", "c"])).toEqual([{ id: "b" }]);
  });

  it("treats imported/unknown/dangling links as unlinked", () => {
    const lecs = [{ id: "lec1" }];
    expect(isLinked({ linkedLecId: "lec1" }, lecs)).toBe(true);
    expect(isLinked({ linkedLecId: "imported" }, lecs)).toBe(false);
    expect(isLinked({ linkedLecId: "unknown" }, lecs)).toBe(false);
    expect(isLinked({ linkedLecId: "gone" }, lecs)).toBe(false);
    expect(isLinked({}, lecs)).toBe(false);
  });

  it("deletes only the unlinked ones", () => {
    const list = [{ id: "a", linkedLecId: "lec1" }, { id: "b", linkedLecId: "imported" }, { id: "c" }];
    expect(deleteUnlinked(list, [{ id: "lec1" }])).toEqual([{ id: "a", linkedLecId: "lec1" }]);
  });
});

describe("replaceLectureObjectives", () => {
  const other = { id: "x", linkedLecId: "lec2", objective: "Describe the pancreas" };

  it("swaps this lecture's objectives and leaves every other lecture alone", () => {
    const before = [other, { id: "old", linkedLecId: "lec1", objective: "Stale" }];
    const after = replaceLectureObjectives(before, "lec1", [{ id: "new", objective: "Describe the thyroid" }]);

    expect(after).toHaveLength(2);
    expect(after.find((o) => o.id === "x")).toEqual(other);
    expect(after.find((o) => o.id === "new")).toMatchObject({ linkedLecId: "lec1", sourceFile: "lec1" });
    expect(after.find((o) => o.id === "old")).toBeUndefined();
  });

  it("matches on sourceFile too, which is how older rows point at a lecture", () => {
    const before = [{ id: "old", sourceFile: "lec1", objective: "Stale" }];
    expect(replaceLectureObjectives(before, "lec1", [])).toEqual([]);
  });

  it("carries a personal note onto the same objective in the new pass", () => {
    const before = [
      { id: "old", linkedLecId: "lec1", objective: "Describe the thyroid axis", personalNotes: "ask about TSH" },
    ];
    const after = replaceLectureObjectives(before, "lec1", [
      { id: "new", objective: "Describe the thyroid axis!" },
      { id: "new2", objective: "Outline calcium handling" },
    ]);

    expect(after.find((o) => o.id === "new").personalNotes).toBe("ask about TSH");
    expect(after.find((o) => o.id === "new2").personalNotes).toBeUndefined();
  });

  it("does not overwrite a note the new pass already carries", () => {
    const before = [{ id: "old", linkedLecId: "lec1", objective: "Describe X", personalNotes: "old note" }];
    const after = replaceLectureObjectives(before, "lec1", [
      { id: "new", objective: "Describe X", personalNotes: "new note" },
    ]);
    expect(after[0].personalNotes).toBe("new note");
  });

  it("is a no-op without a lecture id", () => {
    const list = [{ id: "a" }];
    expect(replaceLectureObjectives(list, null, [{ id: "b" }])).toBe(list);
  });
});

describe("rollups", () => {
  const mixed = [
    { id: "a", status: "mastered", bloom_level: 1, bloom_level_name: "Remember" },
    { id: "b", status: "in_progress", bloom_level: 1 },
    { id: "c", status: "struggling", bloom_level: 2 },
    { id: "d", bloom_level: 2 },
  ];

  it("counts statuses with anything unrecognised as untested", () => {
    expect(statusCounts(mixed)).toEqual({ mastered: 1, in_progress: 1, struggling: 1, untested: 1, total: 4 });
    expect(statusCounts([{ status: "bogus" }]).untested).toBe(1);
  });

  it("computes coverage, and null when there is nothing to cover", () => {
    expect(coveragePct(mixed)).toBe(25);
    expect(coveragePct([])).toBeNull();
  });

  it("rolls up per bloom level, sorted, carrying the level name", () => {
    const rollup = bloomRollup(mixed);
    expect(rollup.map((r) => r.level)).toEqual([1, 2]);
    expect(rollup[0]).toMatchObject({ name: "Remember", coverage: 50 });
    expect(rollup[1].counts).toMatchObject({ struggling: 1, untested: 1, total: 2 });
  });

  it("reports alignment against the block's lectures", () => {
    const list = [
      { id: "a", linkedLecId: "lec1" },
      { id: "b", linkedLecId: "lec1" },
      { id: "c", linkedLecId: "imported" },
      { id: "d" },
    ];
    expect(alignmentStats(list, [{ id: "lec1" }])).toEqual({
      total: 4, linked: 2, unlinked: 2, pct: 50, byLecture: { lec1: 2 },
    });
    expect(alignmentStats([], []).pct).toBeNull();
  });
});

describe("command handlers", () => {
  function harness(store = { b1: { imported: [{ id: "a" }, { id: "b" }], extracted: [] } }) {
    const writes = [];
    const notify = vi.fn();
    const commands = createObjectiveCommands({
      read: () => store,
      write: (next) => { store = next; writes.push(next); },
      now: () => NOW,
      notify,
    });
    return { commands, writes, notify, current: () => store };
  }

  it("writes the reduced block back under its own key and notifies", () => {
    const { commands, writes, notify, current } = harness();
    const result = commands.setStatus("b1", "a", "mastered");

    expect(result).toMatchObject({ blockId: "b1", key: "b1" });
    expect(result.objectives[0]).toMatchObject({ status: "mastered", lastUpdated: NOW });
    expect(writes).toHaveLength(1);
    expect(current().b1.imported[0].status).toBe("mastered");
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("does not write when the reducer changes nothing", () => {
    const { commands, writes, notify } = harness();
    expect(commands.setStatus("b1", "missing", "mastered")).toBeNull();
    expect(commands.deleteObjectives("b1", [])).toBeNull();
    expect(commands.setStatus("", "a", "mastered")).toBeNull();
    expect(writes).toHaveLength(0);
    expect(notify).not.toHaveBeenCalled();
  });

  it("keeps a delete deleted rather than merging it back", () => {
    const { commands, current } = harness();
    commands.deleteObjectives("b1", ["a"]);
    expect(current().b1.imported.map((o) => o.id)).toEqual(["b"]);
    expect(current().b1.extracted).toEqual([]);
  });

  it("leaves other blocks alone", () => {
    const { commands, current } = harness({
      b1: [{ id: "a" }],
      b2: [{ id: "z" }],
    });
    commands.deleteObjectives("b1", ["a"]);
    expect(current().b2).toEqual([{ id: "z" }]);
  });

  it("writes through the legacy msk slot when that is where the data lives", () => {
    const { commands, current } = harness({ msk: [{ id: "a" }] });
    const result = commands.assignToLecture("msk", "a", "lec1");
    expect(result.key).toBe("msk");
    expect(current().msk[0]).toMatchObject({ linkedLecId: "lec1", alignedAt: NOW });
  });

  it("drops unlinked objectives for a block", () => {
    const { commands, current } = harness({ b1: [{ id: "a", linkedLecId: "lec1" }, { id: "b" }] });
    commands.deleteUnlinked("b1", [{ id: "lec1" }]);
    expect(current().b1).toEqual([{ id: "a", linkedLecId: "lec1" }]);
  });
});
