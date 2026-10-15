import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { installDomStorage } from "./testEnv.js";
import * as lectures from "./lectures.js";
import { isLocalStorageQuotaError } from "./base.js";

beforeEach(() => installDomStorage());
afterEach(() => { vi.restoreAllMocks(); window.dispatchEvent(new StorageEvent("storage", { key: null })); });

it("keeps a confirmed cloud upload usable when the local cache is full", () => {
  const old = [{ id: "existing", fullText: "unsynced local notes" }];
  lectures.write("user", old);
  const next = [...old, { id: "uploaded", chunks: [] }];
  const spy = vi.spyOn(window.Storage.prototype, "setItem").mockImplementation(() => {
    throw new DOMException("full", "QuotaExceededError");
  });
  expect(() => lectures.writeCloudSaved("user", next)).not.toThrow();
  expect(lectures.read("user")).toEqual(next);
  expect(JSON.parse(localStorage.getItem("rxt:user:rxt-lec-meta"))).toEqual(old);
  expect(lectures.read("other")).toEqual([]);
  spy.mockRestore();
  lectures.write("user", [...next, { id: "later" }]);
  expect(lectures.read("user")).toHaveLength(3);
});

it("does not hide local-only write failures or cloud quota errors", () => {
  vi.spyOn(window.Storage.prototype, "setItem").mockImplementation(() => {
    throw new DOMException("full", "QuotaExceededError");
  });
  expect(() => lectures.write(null, [{ id: "guest" }])).toThrow();
  expect(() => lectures.writeCloudSaved(null, [{ id: "guest" }])).toThrow();
  expect(isLocalStorageQuotaError(new Error("Firebase quota exhausted"))).toBe(false);
});

it("does not hide unrelated cache errors", () => {
  vi.spyOn(window.Storage.prototype, "setItem").mockImplementation(() => { throw new Error("access denied"); });
  expect(() => lectures.writeCloudSaved("user", [])).toThrow("access denied");
});
