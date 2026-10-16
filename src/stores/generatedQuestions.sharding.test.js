import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __setCloudBackendForTests,
  resetCloudStores,
} from "./cloudBase.js";
import * as generatedQuestions from "./generatedQuestions.js";

function fakeBackend() {
  const listeners = new Map();
  const writes = [];
  return {
    writes,
    emit(path, data) {
      listeners.get(path)?.next({ exists: () => data !== undefined, data: () => ({ data }) });
    },
    api: {
      doc: (_db, ...segments) => segments.join("/"),
      onSnapshot: (path, next, error) => { listeners.set(path, { next, error }); return () => listeners.delete(path); },
      setDoc: (path, value) => { writes.push({ path, value }); return Promise.resolve(); },
      serverTimestamp: () => "SERVER_TS",
    },
  };
}

let backend;
beforeEach(() => {
  backend = fakeBackend();
  __setCloudBackendForTests(backend.api);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  resetCloudStores();
  __setCloudBackendForTests(null);
  vi.restoreAllMocks();
});

describe("generated question Firestore sharding", () => {
  it("migrates a legacy pool into bounded documents and persists new questions there", async () => {
    const userId = "generated-shard-user";
    generatedQuestions.read(userId);
    backend.emit(`users/${userId}/kv/rxt-gen-questions`, {
      oldLecture: { generatedAt: "2026-01-01", questions: [{ stem: "An existing question", choices: { A: "one", B: "two" }, correct: "A" }] },
    });
    backend.emit(`users/${userId}/kv/rxt-gen-questions-index-v2`, undefined);

    generatedQuestions.addQuestions(userId, "newLecture", [
      { stem: "First distinct question", choices: { A: "one", B: "two" }, correct: "A", explanation: "a".repeat(145_000) },
      { stem: "Second different question", choices: { A: "three", B: "four" }, correct: "B", explanation: "b".repeat(145_000) },
      { stem: "Third unrelated question", choices: { A: "five", B: "six" }, correct: "A", explanation: "c".repeat(145_000) },
    ]);
    await generatedQuestions.flushPendingWrites();

    const shardWrites = backend.writes.filter(({ path }) => path.includes("rxt-gen-questions-v2%3A"));
    expect(shardWrites.length).toBeGreaterThanOrEqual(2);
    expect(shardWrites.every(({ value }) => new TextEncoder().encode(JSON.stringify(value)).length < 1_048_576)).toBe(true);
    expect(backend.writes.some(({ path }) => path.endsWith("/kv/rxt-gen-questions"))).toBe(false);
    expect(generatedQuestions.questionsForLecture(userId, "oldLecture")).toHaveLength(1);
    expect(generatedQuestions.questionsForLecture(userId, "newLecture")).toHaveLength(3);
  });
});
