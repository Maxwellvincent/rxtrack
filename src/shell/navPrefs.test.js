import { beforeEach, describe, expect, it } from "vitest";
import { installDomStorage } from "../stores/testEnv.js";
import {
  readCollapsedTerms,
  writeCollapsedTerms,
  toggleTerm,
  collapseAllExcept,
  isTermVisible,
  defaultBlockId,
  NAV_PREFS_KEY,
} from "./navPrefs.js";

const terms = [
  { id: "t1", blocks: [{ id: "b1" }, { id: "b2" }] },
  { id: "t2", blocks: [{ id: "b3" }] },
  { id: "t3", blocks: [] },
];

describe("collapsed-term persistence", () => {
  beforeEach(() => installDomStorage());

  it("round-trips through localStorage", () => {
    writeCollapsedTerms(new Set(["t1", "t3"]));
    expect([...readCollapsedTerms()].sort()).toEqual(["t1", "t3"]);
  });

  it("starts with nothing collapsed and survives junk", () => {
    expect(readCollapsedTerms().size).toBe(0);
    localStorage.setItem(NAV_PREFS_KEY, "not json");
    expect(readCollapsedTerms().size).toBe(0);
    localStorage.setItem(NAV_PREFS_KEY, JSON.stringify({ collapsedTerms: "nope" }));
    expect(readCollapsedTerms().size).toBe(0);
  });

  it("keeps other preferences in the same blob intact", () => {
    localStorage.setItem(NAV_PREFS_KEY, JSON.stringify({ somethingElse: 1 }));
    writeCollapsedTerms(new Set(["t1"]));
    expect(JSON.parse(localStorage.getItem(NAV_PREFS_KEY)).somethingElse).toBe(1);
  });
});

describe("toggleTerm", () => {
  it("collapses and expands without mutating the input", () => {
    const start = new Set(["t1"]);
    const expanded = toggleTerm(start, "t1");
    expect(expanded.has("t1")).toBe(false);
    expect(start.has("t1")).toBe(true);
    expect(toggleTerm(expanded, "t2").has("t2")).toBe(true);
  });
});

describe("collapseAllExcept", () => {
  it("leaves one term open — the Term 2 case", () => {
    expect([...collapseAllExcept(terms, "t2")].sort()).toEqual(["t1", "t3"]);
  });

  it("ignores terms with no id, which could never be reopened", () => {
    expect(collapseAllExcept([{ id: null, blocks: [] }, { id: "t1" }], "t9").has(null)).toBe(false);
  });
});

describe("defaultBlockId", () => {
  const blocks = [
    { id: "b1", termId: "t1" },
    { id: "b2", termId: "t1" },
    { id: "b3", termId: "t2" },
  ];

  it("lands in a term you have not collapsed", () => {
    // The Term 2 case: collapse Term 1, and reloads stop dropping you back into it.
    expect(defaultBlockId(blocks, new Set(["t1"]))).toBe("b3");
  });

  it("uses the first block when nothing is collapsed", () => {
    expect(defaultBlockId(blocks, new Set())).toBe("b1");
  });

  it("still returns something when every term is collapsed", () => {
    expect(defaultBlockId(blocks, new Set(["t1", "t2"]))).toBe("b1");
  });

  it("copes with no blocks at all", () => {
    expect(defaultBlockId([], new Set())).toBeNull();
    expect(defaultBlockId(null, null)).toBeNull();
  });
});

describe("isTermVisible", () => {
  const collapsed = new Set(["t1"]);

  it("hides a collapsed term's blocks", () => {
    expect(isTermVisible(terms[0], { collapsed, activeBlockId: "b3" })).toBe(false);
  });

  it("but never hides the block you are actually on", () => {
    expect(isTermVisible(terms[0], { collapsed, activeBlockId: "b2" })).toBe(true);
  });

  it("leaves expanded terms alone", () => {
    expect(isTermVisible(terms[1], { collapsed, activeBlockId: "b1" })).toBe(true);
  });
});
