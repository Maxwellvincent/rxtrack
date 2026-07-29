import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import {
  __setCloudBackendForTests,
  isHydrated,
  readCloud,
  readError,
  resetCloudStores,
  writeCloud,
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
