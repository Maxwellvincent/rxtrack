import { describe, expect, it } from "vitest";
import { resolveTodayQueue, sharedQueueFor, withSharedQueue } from "./todayQueueSync.js";

const items = [{ id: "a", kind: "review" }, { id: "b", kind: "first" }];

describe("sharedQueueFor", () => {
  it("returns only today's queue for the block", () => {
    const doc = { b1: { day: "2026-11-26", cap: 6, items }, b2: { day: "2026-11-25", cap: 6, items } };
    expect(sharedQueueFor(doc, "b1", "2026-11-26")).toEqual({ cap: 6, items });
    expect(sharedQueueFor(doc, "b2", "2026-11-26")).toBeNull();
    expect(sharedQueueFor(null, "b1", "2026-11-26")).toBeNull();
  });
});

describe("withSharedQueue", () => {
  it("replaces one block's entry, keeps the others, and strips extra fields", () => {
    const doc = { b2: { day: "x", cap: 1, items: [] } };
    const next = withSharedQueue(doc, "b1", "2026-11-26", { cap: 5, items: [{ id: "a", kind: "review", row: {} }] }, 7);
    expect(next).toEqual({ b2: doc.b2, b1: { day: "2026-11-26", cap: 5, items: [{ id: "a", kind: "review" }], updatedAt: 7 } });
  });
  it("accepts the old array form", () => {
    expect(withSharedQueue({}, "b1", "d", items, 1).b1.cap).toBe(2);
  });
});

describe("resolveTodayQueue", () => {
  const local = { cap: 6, items };
  const shared = { cap: 5, items: items.slice(0, 1) };
  it("uses the cloud queue over this device's", () => {
    expect(resolveTodayQueue({ signedIn: true, cloudLoaded: true, shared, local })).toEqual({ queue: shared, canFreeze: false, upload: false });
  });
  it("waits for the cloud copy before freezing or uploading", () => {
    expect(resolveTodayQueue({ signedIn: true, cloudLoaded: false, shared: null, local: null })).toEqual({ queue: null, canFreeze: false, upload: false });
  });
  it("freezes when nothing exists, then uploads the local queue", () => {
    expect(resolveTodayQueue({ signedIn: true, cloudLoaded: true, shared: null, local: null }).canFreeze).toBe(true);
    expect(resolveTodayQueue({ signedIn: true, cloudLoaded: true, shared: null, local })).toEqual({ queue: local, canFreeze: false, upload: true });
  });
  it("signed out stays local", () => {
    expect(resolveTodayQueue({ signedIn: false, cloudLoaded: false, shared: null, local: null })).toEqual({ queue: null, canFreeze: true, upload: false });
  });
});
