import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { installDomStorage } from "./testEnv.js";
import {
  __setCloudBackendForTests,
  docPathFor,
  isHydrated,
  readCloud,
  readError,
  resetCloudStores,
  writeCloud,
  writeCloudAwait,
} from "./cloudBase.js";

/**
 * A fake Firestore: records the docs asked for, hands back a snapshot when the
 * test decides one has arrived. No emulator, matching the seam functions/index.js
 * uses for the same reason.
 */
function makeBackend() {
  const listeners = new Map(); // path -> { next, error }
  const writes = [];
  return {
    listeners,
    writes,
    emit(path, data) {
      listeners.get(path)?.next({ exists: () => data !== undefined, data: () => ({ data }) });
    },
    fail(path, error) {
      listeners.get(path)?.error(error);
    },
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

let backend;
const PATH = "users/u1/kv/rxt-exam-dates";

beforeEach(() => {
  installDomStorage();
  backend = makeBackend();
  __setCloudBackendForTests(backend.api);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  resetCloudStores();
  __setCloudBackendForTests(null);
  vi.restoreAllMocks();
});

describe("readCloud", () => {
  it("returns the fallback and reports un-hydrated until the first snapshot", () => {
    expect(readCloud("u1", "rxt-exam-dates", {})).toEqual({});
    expect(isHydrated("u1", "rxt-exam-dates")).toBe(false);
  });

  it("serves the snapshot once it lands", () => {
    readCloud("u1", "rxt-exam-dates", {});
    backend.emit(PATH, { b1: "2026-08-31" });

    expect(readCloud("u1", "rxt-exam-dates", {})).toEqual({ b1: "2026-08-31" });
    expect(isHydrated("u1", "rxt-exam-dates")).toBe(true);
  });

  it("treats a missing document as the fallback, but hydrated", () => {
    readCloud("u1", "rxt-exam-dates", {});
    backend.emit(PATH, undefined);

    expect(readCloud("u1", "rxt-exam-dates", { seeded: true })).toEqual({ seeded: true });
    expect(isHydrated("u1", "rxt-exam-dates")).toBe(true);
  });

  it("subscribes once however many times it is read", () => {
    readCloud("u1", "rxt-exam-dates", {});
    readCloud("u1", "rxt-exam-dates", {});
    readCloud("u1", "rxt-exam-dates", {});
    expect(backend.listeners.size).toBe(1);
  });

  it("keeps users apart", () => {
    readCloud("u1", "rxt-exam-dates", {});
    readCloud("u2", "rxt-exam-dates", {});
    backend.emit(PATH, { b1: "u1 date" });

    expect(readCloud("u1", "rxt-exam-dates", {})).toEqual({ b1: "u1 date" });
    expect(readCloud("u2", "rxt-exam-dates", {})).toEqual({});
  });

  it("reads as the fallback when signed out, and never subscribes", () => {
    expect(readCloud(null, "rxt-exam-dates", { local: true })).toEqual({ local: true });
    expect(backend.listeners.size).toBe(0);
    expect(isHydrated(null, "rxt-exam-dates")).toBe(true);
  });
});

describe("writeCloud", () => {
  it("writes the document authoritatively and updates the cache immediately", () => {
    writeCloud("u1", "rxt-exam-dates", { b1: "2026-09-30" });

    expect(readCloud("u1", "rxt-exam-dates", {})).toEqual({ b1: "2026-09-30" });
    expect(backend.writes).toHaveLength(1);
    expect(backend.writes[0].path).toBe(PATH);
    expect(backend.writes[0].value).toEqual({ data: { b1: "2026-09-30" }, updatedAt: "SERVER_TS" });
  });

  it("does not wait for the round trip before the value is readable", () => {
    // The write promise is deliberately not awaited here.
    writeCloud("u1", "rxt-exam-dates", { b1: "x" });
    expect(readCloud("u1", "rxt-exam-dates", {})).toEqual({ b1: "x" });
  });

  it("survives a rejected write without losing the local value", async () => {
    __setCloudBackendForTests({ ...backend.api, setDoc: () => Promise.reject(new Error("offline")) });
    writeCloud("u1", "rxt-exam-dates", { b1: "queued" });
    await Promise.resolve();
    expect(readCloud("u1", "rxt-exam-dates", {})).toEqual({ b1: "queued" });
  });

  it("is a no-op when signed out", () => {
    writeCloud(null, "rxt-exam-dates", { b1: "x" });
    expect(backend.writes).toHaveLength(0);
  });
});

describe("writeCloudAwait", () => {
  it("resolves with the value on a successful write", async () => {
    const result = await writeCloudAwait("u1", "rxt-exam-dates", { b1: "2026-09-30" });
    expect(result).toEqual({ b1: "2026-09-30" });
    expect(readCloud("u1", "rxt-exam-dates", {})).toEqual({ b1: "2026-09-30" });
    expect(backend.writes).toHaveLength(1);
  });

  it("updates the cache optimistically before the round trip resolves", () => {
    // The write promise is deliberately not awaited here.
    writeCloudAwait("u1", "rxt-exam-dates", { b1: "x" });
    expect(readCloud("u1", "rxt-exam-dates", {})).toEqual({ b1: "x" });
  });

  it("rejects when the underlying write fails, instead of swallowing it", async () => {
    __setCloudBackendForTests({ ...backend.api, setDoc: () => Promise.reject(new Error("offline")) });
    await expect(writeCloudAwait("u1", "rxt-exam-dates", { b1: "queued" })).rejects.toThrow("offline");
  });

  it("is a no-op that resolves with the value when signed out", async () => {
    const result = await writeCloudAwait(null, "rxt-exam-dates", { b1: "x" });
    expect(result).toEqual({ b1: "x" });
    expect(backend.writes).toHaveLength(0);
  });
});

describe("undefined fields", () => {
  it("strips them, because Firestore rejects the whole write over one", () => {
    // localStorage never cared — JSON.stringify drops undefined — so the data
    // has carried fields like lastConfidence: undefined for years.
    writeCloud("u1", "rxt-exam-dates", {
      b1: { date: "2026-08-31", lastConfidence: undefined },
      b2: undefined,
      b3: { nested: [{ keep: 1, drop: undefined }] },
    });

    expect(backend.writes.at(-1).value.data).toEqual({
      b1: { date: "2026-08-31" },
      b3: { nested: [{ keep: 1 }] },
    });
  });

  it("keeps the value readable in full locally, undefined and all", () => {
    writeCloud("u1", "rxt-exam-dates", { b1: "2026-08-31", b2: undefined });
    expect(readCloud("u1", "rxt-exam-dates", {})).toEqual({ b1: "2026-08-31", b2: undefined });
  });
});

describe("where each key lives in Firestore", () => {
  it("reads the five state stores from state/{name}, not kv", () => {
    // Found live: terms came back EMPTY because it was read from kv/rxt-terms,
    // and it is state/terms. The state doc names do not match the localStorage
    // keys either â€” weak-concepts is weak_concepts, tracker-v2 is tracker.
    expect(docPathFor("u1", "rxt-terms")).toEqual(["users", "u1", "state", "terms"]);
    expect(docPathFor("u1", "rxt-performance")).toEqual(["users", "u1", "state", "performance"]);
    expect(docPathFor("u1", "rxt-completion")).toEqual(["users", "u1", "state", "completion"]);
    expect(docPathFor("u1", "rxt-weak-concepts")).toEqual(["users", "u1", "state", "weak_concepts"]);
    expect(docPathFor("u1", "rxt-tracker-v2")).toEqual(["users", "u1", "state", "tracker"]);
  });

  it("reads everything else from kv", () => {
    expect(docPathFor("u1", "rxt-exam-dates")).toEqual(["users", "u1", "kv", "rxt-exam-dates"]);
    expect(docPathFor("u1", "rxt-assessments")).toEqual(["users", "u1", "kv", "rxt-assessments"]);
  });

  it("refuses the two keys that are collections rather than documents", () => {
    // A document per lecture and a document per block; serving either from a
    // single doc would silently read nothing.
    expect(() => docPathFor("u1", "rxt-lec-meta")).toThrow(/collection/);
    expect(() => docPathFor("u1", "rxt-block-objectives")).toThrow(/collection/);
  });
});

describe("the localStorage mirror for keys App still reads", () => {
  const TERMS_PATH = "users/u1/state/terms";

  it("shadows a write for a mirrored key", () => {
    writeCloud("u1", "rxt-terms", [{ id: "t1" }]);
    expect(JSON.parse(localStorage.getItem("rxt:u1:rxt-terms") || localStorage.getItem("rxt-terms")))
      .toEqual([{ id: "t1" }]);
  });

  it("shadows a change that arrived from another device", () => {
    readCloud("u1", "rxt-terms", []);
    backend.emit(TERMS_PATH, [{ id: "from-other-device" }]);
    expect(JSON.parse(localStorage.getItem("rxt:u1:rxt-terms") || localStorage.getItem("rxt-terms")))
      .toEqual([{ id: "from-other-device" }]);
  });

  it("does not shadow a key App does not read", () => {
    localStorage.removeItem("rxt-exam-dates");
    localStorage.removeItem("rxt:u1:rxt-exam-dates");
    writeCloud("u1", "rxt-exam-dates", { b1: "2026-08-31" });
    expect(localStorage.getItem("rxt-exam-dates")).toBeNull();
    expect(localStorage.getItem("rxt:u1:rxt-exam-dates")).toBeNull();
  });

  it("keeps the cloud write even when the mirror throws", () => {
    const setItem = localStorage.setItem;
    localStorage.setItem = () => { throw new Error("QuotaExceededError"); };
    try {
      writeCloud("u1", "rxt-terms", [{ id: "t2" }]);
      expect(readCloud("u1", "rxt-terms", [])).toEqual([{ id: "t2" }]);
      expect(backend.writes.at(-1).path).toBe(TERMS_PATH);
    } finally {
      localStorage.setItem = setItem;
    }
  });
});

describe("listener errors", () => {
  it("keeps the last good value and surfaces the error", () => {
    readCloud("u1", "rxt-exam-dates", {});
    backend.emit(PATH, { b1: "good" });
    backend.fail(PATH, new Error("permission-denied"));

    expect(readCloud("u1", "rxt-exam-dates", {})).toEqual({ b1: "good" });
    expect(readError("u1", "rxt-exam-dates")?.message).toBe("permission-denied");
    // Hydrated so the UI stops waiting; it has a value and an error to show.
    expect(isHydrated("u1", "rxt-exam-dates")).toBe(true);
  });
});

