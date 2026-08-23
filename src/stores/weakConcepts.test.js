import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installDomStorage } from "./testEnv.js";
import * as weakConcepts from "./weakConcepts.js";
import { __setCloudBackendForTests, resetCloudStores } from "./cloudBase.js";

/** Same fake Firestore shape used in cloudBase.test.js. */
function makeBackend() {
  const listeners = new Map();
  const writes = [];
  return {
    listeners,
    writes,
    api: {
      doc: (_db, ...segments) => segments.join("/"),
      onSnapshot: (path, next, error) => {
        listeners.set(path, { next, error });
        return () => listeners.delete(path);
      },
      setDoc: (path, value) => { writes.push({ path, value }); return Promise.resolve(); },
      serverTimestamp: () => "SERVER_TS",
    },
  };
}

describe("weak concepts store", () => {
  beforeEach(() => installDomStorage());

  it("keeps the highest missCount per concept", () => {
    weakConcepts.merge("u1", { b1: [{ id: "c1", missCount: 1 }] });
    weakConcepts.merge("u1", { b1: [{ id: "c1", missCount: 4 }, { id: "c2", missCount: 1 }] });
    expect(weakConcepts.read("u1").b1).toEqual([{ id: "c1", missCount: 4 }, { id: "c2", missCount: 1 }]);
  });
});

describe("writeAwait", () => {
  beforeEach(() => installDomStorage());

  it("is a no-op that resolves with the value when signed out", async () => {
    const value = { b1: [{ id: "c1", missCount: 1 }] };
    const result = await weakConcepts.writeAwait(null, value);
    expect(result).toEqual(value);
  });

  describe("signed-in cloud path", () => {
    let backend;

    beforeEach(() => {
      backend = makeBackend();
      __setCloudBackendForTests(backend.api);
      vi.spyOn(console, "warn").mockImplementation(() => {});
    });

    afterEach(() => {
      resetCloudStores();
      __setCloudBackendForTests(null);
      vi.restoreAllMocks();
    });

    it("resolves with the value on a successful write", async () => {
      const value = { b1: [{ id: "c1", missCount: 1 }] };
      const result = await weakConcepts.writeAwait("u1", value);
      expect(result).toEqual(value);
      expect(backend.writes).toHaveLength(1);
    });

    it("propagates a write rejection instead of silently succeeding", async () => {
      __setCloudBackendForTests({ ...backend.api, setDoc: () => Promise.reject(new Error("offline")) });
      await expect(weakConcepts.writeAwait("u1", { b1: [] })).rejects.toThrow("offline");
    });
  });
});
