import { beforeEach, describe, expect, it } from "vitest";
import { loadUploadQueueFromSession, normalizeRecoveredQueueItem, persistUploadQueueToSession } from "./uploadQueuePersistence.js";

describe("normalizeRecoveredQueueItem", () => {
  it("returns null for bad input", () => {
    expect(normalizeRecoveredQueueItem(null)).toBe(null);
    expect(normalizeRecoveredQueueItem({})).toBe(null);
  });
  it("keeps terminal statuses", () => {
    const d = { id: "x", status: "done", filename: "a.pdf" };
    expect(normalizeRecoveredQueueItem(d)).toEqual(d);
  });
  it("marks in-progress as queued for blob resume", () => {
    const q = normalizeRecoveredQueueItem({ id: "y", status: "processing", filename: "b.pdf" });
    expect(q.status).toBe("queued");
    expect(q.restoredFromSession).toBe(true);
    expect(q.statusLabel).toMatch(/Restored/i);
  });
  it("preserves collision for blob resume", () => {
    const q = normalizeRecoveredQueueItem({
      id: "z",
      status: "collision",
      filename: "c.pdf",
      collisionLabel: "Lecture exists",
    });
    expect(q.status).toBe("collision");
    expect(q.restoredFromSession).toBe(true);
  });
});

describe("session round-trip", () => {
  const mem = new Map();
  beforeEach(() => {
    mem.clear();
    globalThis.sessionStorage = {
      getItem: (k) => (mem.has(k) ? mem.get(k) : null),
      setItem: (k, v) => {
        mem.set(k, String(v));
      },
      removeItem: (k) => {
        mem.delete(k);
      },
    };
  });
  it("persist and load", () => {
    const key = "rxt-upload-queue-v1";
    sessionStorage.removeItem(key);
    persistUploadQueueToSession([{ id: "a", status: "done", filename: "x.pdf" }]);
    const loaded = loadUploadQueueFromSession();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe("a");
    persistUploadQueueToSession([]);
    expect(sessionStorage.getItem(key)).toBe(null);
  });
});
