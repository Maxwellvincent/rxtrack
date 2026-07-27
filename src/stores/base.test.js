import { beforeEach, describe, expect, it, vi } from "vitest";
import { installDomStorage } from "./testEnv.js";
import { notifyStoreChanged, physicalKey } from "./base.js";
import * as terms from "./terms.js";

describe("store base", () => {
  beforeEach(() => installDomStorage());

  it("namespaces brand-new keys", () => {
    terms.write("u1", [{ id: "t1" }]);
    expect(localStorage.getItem("rxt-terms")).toBeNull();
    expect(JSON.parse(localStorage.getItem(physicalKey("u1", "rxt-terms")))).toEqual([{ id: "t1" }]);
    expect(terms.read("u1")).toEqual([{ id: "t1" }]);
  });

  it("writes into an existing legacy key instead of duplicating it", () => {
    localStorage.setItem("rxt-terms", JSON.stringify([{ id: "legacy" }]));
    expect(terms.read("u1")).toEqual([{ id: "legacy" }]);

    terms.merge("u1", [{ id: "new" }]);

    // One copy, in the slot the data already lived in — a second namespaced
    // copy of a multi-MB key is what blew the quota in the live app.
    expect(localStorage.getItem(physicalKey("u1", "rxt-terms"))).toBeNull();
    expect(JSON.parse(localStorage.getItem("rxt-terms"))).toEqual([{ id: "legacy" }, { id: "new" }]);
    expect(terms.read("u1")).toEqual([{ id: "legacy" }, { id: "new" }]);
  });

  it("keeps writing to a namespaced key once one exists", () => {
    localStorage.setItem("rxt-terms", JSON.stringify([{ id: "legacy" }]));
    localStorage.setItem(physicalKey("u1", "rxt-terms"), JSON.stringify([{ id: "mine" }]));

    terms.write("u1", [{ id: "mine2" }]);

    expect(JSON.parse(localStorage.getItem(physicalKey("u1", "rxt-terms")))).toEqual([{ id: "mine2" }]);
    expect(JSON.parse(localStorage.getItem("rxt-terms"))).toEqual([{ id: "legacy" }]);
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
