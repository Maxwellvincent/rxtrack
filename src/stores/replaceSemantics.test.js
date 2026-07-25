import { beforeEach, describe, expect, it, vi } from "vitest";
import { installDomStorage } from "./testEnv.js";
import { storeForKey } from "./index.js";
import * as terms from "./terms.js";
import * as lectures from "./lectures.js";
import * as objectives from "./blockObjectives.js";
import * as weakConcepts from "./weakConcepts.js";
import * as performance from "./performance.js";
import * as completion from "./completion.js";
import * as examDates from "./examDates.js";
import * as calibration from "./calibration.js";
import * as trackerV2 from "./trackerV2.js";
import * as mcqBank from "./mcqBank.js";

// write() is what a local UI write means: authoritative replace. A user deleting
// an objective/lecture/term must not have it resurrected by a merge on write —
// that is the regression this whole file guards (SP1 T0.3 §2).
const cases = [
  ["terms", terms, [{ id: "t1" }, { id: "t2" }], [{ id: "t1" }]],
  ["lectures", lectures, [{ id: "l1" }, { id: "l2" }], [{ id: "l1" }]],
  [
    "blockObjectives",
    objectives,
    { b1: { imported: [{ id: "o1" }, { id: "o2" }], extracted: [] } },
    { b1: { imported: [{ id: "o1" }], extracted: [] } },
  ],
  ["weakConcepts", weakConcepts, { b1: [{ id: "c1", missCount: 4 }, { id: "c2", missCount: 1 }] }, { b1: [{ id: "c2", missCount: 1 }] }],
  [
    "performance",
    performance,
    { "l1__b1": { sessions: [{ date: "2026-01-01T00:00:00Z", score: 60 }] }, "l2__b1": { sessions: [] } },
    { "l1__b1": { sessions: [] } },
  ],
  ["completion", completion, { "l1__b1": { completionLevel: 3 }, "l2__b1": { completionLevel: 1 } }, { "l1__b1": { completionLevel: 1 } }],
  ["examDates", examDates, { b1: "2026-08-01", b2: "2026-09-01" }, { b1: "2026-08-01" }],
  ["calibration", calibration, [{ concept: "A", ts: 1 }, { concept: "B", ts: 2 }], [{ concept: "A", ts: 1 }]],
  ["trackerV2", trackerV2, { rows: { r1: 1, r2: 2 } }, { rows: { r1: 1 } }],
  ["mcqBank", mcqBank, { o1_r0: { q: "a" }, o2_r0: { q: "b" } }, { o1_r0: { q: "a" } }],
];

describe("store write() replaces, merge() merges", () => {
  beforeEach(() => installDomStorage());

  it.each(cases)("%s: write() drops removed entries", (_name, mod, seeded, pruned) => {
    mod.write("u1", seeded);
    mod.write("u1", pruned);
    expect(mod.read("u1")).toEqual(pruned);
  });

  it.each(cases)("%s: merge() keeps entries missing from the incoming value", (_name, mod, seeded, pruned) => {
    mod.write("u1", seeded);
    mod.merge("u1", pruned);
    expect(mod.read("u1")).not.toEqual(pruned);
  });

  it("notifies subscribers for both write() and merge()", () => {
    const cb = vi.fn();
    const unsub = terms.subscribe(cb);

    terms.write("u1", [{ id: "t1" }]);
    terms.merge("u1", [{ id: "t2" }]);

    expect(cb).toHaveBeenCalledTimes(2);
    unsub();
  });

  it("resolves store modules by logical key and leaves out-of-scope keys unowned", () => {
    expect(storeForKey("rxt-block-objectives")).toBe(objectives);
    expect(storeForKey("rxt-tracker-v2")).toBe(trackerV2);
    expect(storeForKey("rxt-mcq-bank")).toBe(mcqBank);
    expect(storeForKey("rxt-quick-notes")).toBeUndefined();
    expect(storeForKey("rxt-shell-theme")).toBeUndefined();
  });
});
