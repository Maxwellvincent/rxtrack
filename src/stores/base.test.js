import { beforeEach, describe, expect, it, vi } from "vitest";
import { installDomStorage } from "./testEnv.js";
import {
  notifyStoreChanged,
  physicalKey,
  readJson,
  subscribeToStore,
  writeJson,
} from "./base.js";

// Tests base.js itself rather than borrowing a store module: the stores are
// converting to Firestore one at a time, and these assertions are about the
// localStorage codec, not about whichever store happens to still use it.
const KEY = "rxt-test-store";
const unionById = (current = [], next = []) => {
  const seen = new Map((current || []).map((x) => [x.id, x]));
  for (const item of next || []) seen.set(item.id, item);
  return [...seen.values()];
};

describe("store base", () => {
  beforeEach(() => installDomStorage());

  it("namespaces brand-new keys", () => {
    writeJson("u1", KEY, [{ id: "t1" }]);
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(JSON.parse(localStorage.getItem(physicalKey("u1", KEY)))).toEqual([{ id: "t1" }]);
    expect(readJson("u1", KEY, [])).toEqual([{ id: "t1" }]);
  });

  it("writes into an existing legacy key instead of duplicating it", () => {
    localStorage.setItem(KEY, JSON.stringify([{ id: "legacy" }]));
    expect(readJson("u1", KEY, [])).toEqual([{ id: "legacy" }]);

    writeJson("u1", KEY, [{ id: "new" }], { fallback: [], merge: unionById });

    // One copy, in the slot the data already lived in — a second namespaced
    // copy of a multi-MB key is what blew the quota in the live app.
    expect(localStorage.getItem(physicalKey("u1", KEY))).toBeNull();
    expect(JSON.parse(localStorage.getItem(KEY))).toEqual([{ id: "legacy" }, { id: "new" }]);
  });

  it("keeps writing to a namespaced key once one exists", () => {
    localStorage.setItem(KEY, JSON.stringify([{ id: "legacy" }]));
    localStorage.setItem(physicalKey("u1", KEY), JSON.stringify([{ id: "mine" }]));

    writeJson("u1", KEY, [{ id: "mine2" }]);

    expect(JSON.parse(localStorage.getItem(physicalKey("u1", KEY)))).toEqual([{ id: "mine2" }]);
    expect(JSON.parse(localStorage.getItem(KEY))).toEqual([{ id: "legacy" }]);
  });

  it("notifies subscribers for in-process writes and direct notify calls", () => {
    const cb = vi.fn();
    const unsub = subscribeToStore(KEY, cb);

    writeJson("u1", KEY, [{ id: "t1" }]);
    notifyStoreChanged(KEY);

    expect(cb).toHaveBeenCalledTimes(2);
    unsub();
  });

  it("stays silent when asked, so a mirrored write is announced once", () => {
    const cb = vi.fn();
    const unsub = subscribeToStore(KEY, cb);

    writeJson("u1", KEY, [{ id: "shadow" }], { silent: true });

    expect(cb).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem(physicalKey("u1", KEY)))).toEqual([{ id: "shadow" }]);
    unsub();
  });

  it("bridges cross-tab storage events into store notifications", () => {
    const cb = vi.fn();
    const unsub = subscribeToStore(KEY, cb);

    window.dispatchEvent(new StorageEvent("storage", { key: `rxt:u1:${KEY}` }));

    expect(cb).toHaveBeenCalledTimes(1);
    unsub();
  });
});
