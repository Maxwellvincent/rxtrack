import { beforeEach, describe, expect, it, vi } from "vitest";
import { installDomStorage } from "./testEnv.js";
import { notifyStoreChanged, physicalKey } from "./base.js";
import * as terms from "./terms.js";

describe("store base", () => {
  beforeEach(() => installDomStorage());

  it("uses userId namespacing with legacy read-through fallback", () => {
    localStorage.setItem("rxt-terms", JSON.stringify([{ id: "legacy" }]));
    expect(terms.read("u1")).toEqual([{ id: "legacy" }]);

    terms.write("u1", [{ id: "new" }]);
    expect(localStorage.getItem("rxt-terms")).toBe(JSON.stringify([{ id: "legacy" }]));
    expect(JSON.parse(localStorage.getItem(physicalKey("u1", "rxt-terms")))).toEqual([{ id: "legacy" }, { id: "new" }]);
    expect(terms.read("u2")).toEqual([{ id: "legacy" }]);
  });

  it("notifies subscribers for in-process writes and direct notify calls", () => {
    const cb = vi.fn();
    const unsub = terms.subscribe(cb);

    terms.write("u1", [{ id: "t1" }]);
    notifyStoreChanged("rxt-terms");

    expect(cb).toHaveBeenCalledTimes(2);
    unsub();
  });

  it("bridges cross-tab storage events into store notifications", () => {
    const cb = vi.fn();
    const unsub = terms.subscribe(cb);

    window.dispatchEvent(new StorageEvent("storage", { key: "rxt:u1:rxt-terms" }));

    expect(cb).toHaveBeenCalledTimes(1);
    unsub();
  });
});
