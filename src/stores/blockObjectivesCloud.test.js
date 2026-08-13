import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { installDomStorage } from "./testEnv.js";
import {
  HOT_BLOCK_LIMIT,
  __setObjectivesBackendForTests,
  hotBlocks,
  isHydrated,
  merge,
  read,
  resetObjectivesStore,
  touchBlock,
  write,
} from "./blockObjectivesCloud.js";

/** Fake Firestore collection listener; the test decides when a snapshot lands. */
function makeBackend() {
  const listeners = [];
  const writes = [];
  return {
    writes,
    emit(entriesByBlock) {
      const docs = Object.entries(entriesByBlock).map(([id, data]) => ({ id, data: () => ({ data }) }));
      listeners.forEach((l) => l.next({ forEach: (fn) => docs.forEach(fn) }));
    },
    fail(error) { listeners.forEach((l) => l.error(error)); },
    api: {
      collection: (_db, ...segments) => segments.join("/"),
      doc: (_db, ...segments) => segments.join("/"),
      onSnapshot: (_path, next, error) => { listeners.push({ next, error }); return () => {}; },
      setDoc: (path, value) => { writes.push({ path, value }); return Promise.resolve(); },
      deleteDoc: (path) => { writes.push({ path, value: null }); return Promise.resolve(); },
      serverTimestamp: () => "TS",
    },
  };
}

let backend;
const entry = (n) => ({ imported: [], extracted: [{ id: `o${n}`, objective: `Objective ${n}` }] });

beforeEach(() => {
  installDomStorage();
  backend = makeBackend();
  __setObjectivesBackendForTests(backend.api);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  resetObjectivesStore();
  __setObjectivesBackendForTests(null);
  vi.restoreAllMocks();
});

describe("read", () => {
  it("falls back to localStorage until the first snapshot", () => {
    localStorage.setItem("rxt-block-objectives", JSON.stringify({ b1: entry(1) }));
    expect(read("u1")).toEqual({ b1: entry(1) });
    expect(isHydrated("u1")).toBe(false);
  });

  it("serves every block once the collection snapshot lands", () => {
    read("u1");
    backend.emit({ b1: entry(1), b2: entry(2) });

    expect(Object.keys(read("u1")).sort()).toEqual(["b1", "b2"]);
    expect(isHydrated("u1")).toBe(true);
  });

  it("reads localStorage when signed out", () => {
    localStorage.setItem("rxt-block-objectives", JSON.stringify({ b9: entry(9) }));
    expect(read(null)).toEqual({ b9: entry(9) });
  });
});

describe("write", () => {
  it("writes one document per changed block, and only the changed ones", () => {
    read("u1");
    backend.emit({ b1: entry(1), b2: entry(2) });
    backend.writes.length = 0;

    write("u1", { b1: entry(1), b2: entry(99) });

    expect(backend.writes).toHaveLength(1);
    expect(backend.writes[0].path).toBe("users/u1/objectives/b2");
    expect(backend.writes[0].value.data).toEqual(entry(99));
  });

  it("makes the new value readable immediately", () => {
    write("u1", { b1: entry(5) });
    expect(read("u1").b1).toEqual(entry(5));
  });

  it("merge folds incoming blocks over what is there", () => {
    read("u1");
    backend.emit({ b1: entry(1) });
    merge("u1", { b2: entry(2) });

    expect(Object.keys(read("u1")).sort()).toEqual(["b1", "b2"]);
  });
});

describe("the hot-block mirror for App", () => {
  const mirrored = () =>
    JSON.parse(localStorage.getItem("rxt:u1:rxt-block-objectives") || localStorage.getItem("rxt-block-objectives") || "{}");

  it("mirrors only the blocks recently worked in", () => {
    read("u1");
    touchBlock("b1");
    backend.emit({ b1: entry(1), b2: entry(2), b3: entry(3) });

    expect(Object.keys(mirrored())).toEqual(["b1"]);
  });

  it("keeps at most the hot limit, most recent first", () => {
    read("u1");
    ["b1", "b2", "b3", "b4"].forEach(touchBlock);
    expect(hotBlocks()).toHaveLength(HOT_BLOCK_LIMIT);
    expect(hotBlocks()[0]).toBe("b4");
    expect(hotBlocks()).not.toContain("b1");
  });

  it("counts a written block as hot, since writing it means working in it", () => {
    write("u1", { b7: entry(7) });
    expect(hotBlocks()).toContain("b7");
    expect(Object.keys(mirrored())).toEqual(["b7"]);
  });

  it("survives a mirror that throws, because the cloud write already happened", () => {
    const setItem = localStorage.setItem;
    localStorage.setItem = () => { throw new Error("QuotaExceededError"); };
    try {
      write("u1", { b1: entry(1) });
      expect(read("u1").b1).toEqual(entry(1));
      expect(backend.writes.at(-1).path).toBe("users/u1/objectives/b1");
    } finally {
      localStorage.setItem = setItem;
    }
  });
});

describe("listener errors", () => {
  it("keeps what it had and reports the error", () => {
    read("u1");
    backend.emit({ b1: entry(1) });
    backend.fail(new Error("permission-denied"));

    expect(read("u1").b1).toEqual(entry(1));
    expect(isHydrated("u1")).toBe(true);
  });
});
