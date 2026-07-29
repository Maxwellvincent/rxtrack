import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { installDomStorage } from "./testEnv.js";
import { __setCloudBackendForTests, resetCloudStores } from "./cloudBase.js";
import * as terms from "./terms.js";

// terms is Firestore-first now (Phase B) and mirrored to localStorage while
// App.jsx still reads that key. The backend is faked so these stay unit tests.
function fakeBackend() {
  const writes = [];
  return {
    writes,
    api: {
      doc: (_db, ...segments) => segments.join("/"),
      onSnapshot: () => () => {},
      setDoc: (path, value) => { writes.push({ path, value }); return Promise.resolve(); },
      serverTimestamp: () => "SERVER_TS",
    },
  };
}

let backend;

describe("terms store", () => {
  beforeEach(() => {
    installDomStorage();
    backend = fakeBackend();
    __setCloudBackendForTests(backend.api);
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    resetCloudStores();
    __setCloudBackendForTests(null);
    vi.restoreAllMocks();
  });

  it("round-trips through the cloud store", () => {
    const value = [{ id: "t1", name: "Term 1", blocks: [{ id: "b1", name: "Block 1" }] }];
    terms.write("u1", value);

    expect(terms.read("u1")).toEqual(value);
    // state/terms, not kv — the five state stores have their own documents.
    expect(backend.writes.at(-1).path).toBe("users/u1/state/terms");
    expect(backend.writes.at(-1).value.data).toEqual(value);
  });

  it("merges by term id and preserves distinct blocks", () => {
    terms.merge("u1", [{ id: "t1", name: "Old", blocks: [{ id: "b1" }] }]);
    terms.merge("u1", [{ id: "t1", name: "New", blocks: [{ id: "b2" }] }]);

    expect(terms.read("u1")).toEqual([{ id: "t1", name: "New", blocks: [{ id: "b1" }, { id: "b2" }] }]);
  });

  it("mirrors to localStorage, because App.jsx still reads this key directly", () => {
    terms.write("u1", [{ id: "t1" }]);
    const mirrored = localStorage.getItem("rxt:u1:rxt-terms") || localStorage.getItem("rxt-terms");
    expect(JSON.parse(mirrored)).toEqual([{ id: "t1" }]);
  });

  it("falls back to localStorage when signed out", () => {
    localStorage.setItem("rxt-terms", JSON.stringify([{ id: "local" }]));
    expect(terms.read(null)).toEqual([{ id: "local" }]);
  });
});
