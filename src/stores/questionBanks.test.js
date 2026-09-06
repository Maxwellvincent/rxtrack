import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installDomStorage } from "./testEnv.js";
import { __setCloudBackendForTests, resetCloudStores } from "./cloudBase.js";
import * as questionBanks from "./questionBanks.js";

function fakeBackend() {
  const listeners = new Map();
  const writes = [];
  return {
    writes,
    emit(path, data) { listeners.get(path)?.next({ exists: () => data !== undefined, data: () => ({ data }) }); },
    api: {
      doc: (_db, ...segments) => segments.join("/"),
      onSnapshot: (path, next) => { listeners.set(path, { next }); return () => listeners.delete(path); },
      setDoc: (path, value) => { writes.push({ path, value }); return Promise.resolve(); },
      serverTimestamp: () => "SERVER_TS",
    },
  };
}

let backend;
beforeEach(() => {
  installDomStorage();
  backend = fakeBackend();
  __setCloudBackendForTests(backend.api);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => { resetCloudStores(); __setCloudBackendForTests(null); vi.restoreAllMocks(); });

describe("questionBanks sharded persistence", () => {
  it("writes added banks separately without rewriting the legacy bank document", async () => {
    questionBanks.read("u1");
    backend.emit("users/u1/kv/rxt-question-banks", { "old.pdf": [{ id: "old" }] });
    backend.emit("users/u1/kv/rxt-question-bank-index-v2", undefined);
    const old = questionBanks.read("u1")["old.pdf"];

    await questionBanks.writeAwait("u1", { "old.pdf": old, "new.pdf": [{ id: "new" }] });

    expect(backend.writes.map((write) => write.path)).toEqual([
      "users/u1/kv/rxt-question-bank-v2%3Anew%2Epdf",
      "users/u1/kv/rxt-question-bank-index-v2",
    ]);
  });
});
