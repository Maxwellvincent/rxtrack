import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installDomStorage } from "./testEnv.js";
import { __setCloudBackendForTests, resetCloudStores } from "./cloudBase.js";
import * as questionBankMeta from "./questionBankMeta.js";

// Firestore-first, same fake-backend pattern as terms.test.js.
function fakeBackend() {
  const writes = [];
  return {
    writes,
    api: {
      doc: (_db, ...segments) => segments.join("/"),
      onSnapshot: () => () => {},
      setDoc: (path, value) => { writes.push({ path, value }); return Promise.resolve(); },
      serverTimestamp: () => "SERVER_TS",
    },
  };
}

let backend;

describe("questionBankMeta store", () => {
  beforeEach(() => {
    installDomStorage();
    backend = fakeBackend();
    __setCloudBackendForTests(backend.api);
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    resetCloudStores();
    __setCloudBackendForTests(null);
    vi.restoreAllMocks();
  });

  it("recordUpload creates an entry with a generated bankId", () => {
    questionBankMeta.recordUpload("u1", { filename: "exam1.pdf", blockId: "b1" });

    const entries = Object.entries(questionBankMeta.read("u1"));
    expect(entries).toHaveLength(1);
    const [bankId, entry] = entries[0];
    expect(bankId).toBeTruthy();
    expect(entry).toMatchObject({ filename: "exam1.pdf", blockId: "b1", sourceKind: "school" });
    expect(typeof entry.uploadedAt).toBe("number");
  });

  it("stores supplemental provenance separately from school evidence", () => {
    questionBankMeta.recordUpload("u1", { filename: "student.pdf", blockId: "b1", sourceKind: "supplemental" });
    expect(Object.values(questionBankMeta.read("u1"))[0]).toMatchObject({ sourceKind: "supplemental" });
  });

  it("recordUpload replaces an existing entry for the same filename (single-owner-per-filename)", () => {
    questionBankMeta.recordUpload("u1", { filename: "exam1.pdf", blockId: "b1" });
    const firstBankId = Object.keys(questionBankMeta.read("u1"))[0];

    questionBankMeta.recordUpload("u1", { filename: "exam1.pdf", blockId: "b2" });

    const entries = Object.entries(questionBankMeta.read("u1"));
    expect(entries).toHaveLength(1);
    const [bankId, entry] = entries[0];
    expect(bankId).not.toBe(firstBankId);
    expect(entry).toMatchObject({ filename: "exam1.pdf", blockId: "b2" });
  });

  it("recordUpload replaces an existing entry for the same filename under the same blockId too", () => {
    questionBankMeta.recordUpload("u1", { filename: "exam1.pdf", blockId: "b1" });
    questionBankMeta.recordUpload("u1", { filename: "exam1.pdf", blockId: "b1" });

    expect(Object.keys(questionBankMeta.read("u1"))).toHaveLength(1);
  });

  it("newestForBlock returns the newest matching entry, ordered by uploadedAt", () => {
    const now = Date.now();
    questionBankMeta.write("u1", {
      old: { filename: "old.pdf", blockId: "b1", uploadedAt: now - 1000 },
      newer: { filename: "newer.pdf", blockId: "b1", uploadedAt: now },
      other: { filename: "other.pdf", blockId: "b2", uploadedAt: now + 5000 },
    });

    const result = questionBankMeta.newestForBlock("u1", "b1", {
      existingFilenames: ["old.pdf", "newer.pdf", "other.pdf"],
    });

    expect(result?.filename).toBe("newer.pdf");
  });

  it("newestForBlock skips an entry whose filename isn't in existingFilenames", () => {
    const now = Date.now();
    questionBankMeta.write("u1", {
      newest: { filename: "removed.pdf", blockId: "b1", uploadedAt: now },
      next: { filename: "still-here.pdf", blockId: "b1", uploadedAt: now - 1000 },
    });

    const result = questionBankMeta.newestForBlock("u1", "b1", {
      existingFilenames: ["still-here.pdf"],
    });

    expect(result?.filename).toBe("still-here.pdf");
  });

  it("newestForBlock returns null when nothing matches", () => {
    questionBankMeta.write("u1", {
      a: { filename: "a.pdf", blockId: "b1", uploadedAt: Date.now() },
    });

    expect(questionBankMeta.newestForBlock("u1", "b2", { existingFilenames: ["a.pdf"] })).toBeNull();
    expect(questionBankMeta.newestForBlock("u1", "b1", { existingFilenames: [] })).toBeNull();
  });
});
