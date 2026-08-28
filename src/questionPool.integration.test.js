import { readFileSync } from "node:fs";
import { beforeAll, afterAll, beforeEach, describe, it, expect } from "vitest";
import { initializeTestEnvironment, assertFails } from "@firebase/rules-unit-testing";
import { createQuestionPool } from "./questionPool.js";
import { createSessionShape } from "./examSessions.js";

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)("Firestore prepared question lifecycle", () => {
  let env, database, pool;
  beforeAll(async () => {
    env = await initializeTestEnvironment({ projectId: "demo-rxtrack-pool", firestore: {
      host: "127.0.0.1", port: 8080, rules: readFileSync("firestore.rules", "utf8"),
    } });
    database = env.authenticatedContext("owner").firestore();
    pool = createQuestionPool("owner", "b", database);
  });
  beforeEach(async () => env.clearFirestore());
  afterAll(async () => env?.cleanup());
  const question = { questionId: "q", blockId: "b", lectureId: "l", difficulty: "medium", objectiveIds: ["o"], stem: "A distinct stored question?", choices: { A: "One", B: "Two" }, correct: "A" };
  const session = (id, q) => createSessionShape({ sessionId: id, blockId: "b", lectureIds: ["l"], format: "exam", questions: [q], startedAt: 1000, deadline: 91000 });
  it("stores, reloads and atomically assigns a question, preserving the session and timer", async () => {
    await pool.begin("run", { requestedCount: 1 });
    const saved = await pool.save(question, "bucket", "run");
    expect((await pool.ready("bucket"))).toHaveLength(1);
    expect(await pool.commit(session("s", saved))).toEqual({ ok: true });
    expect(await pool.ready("bucket")).toEqual([]);
    expect(await pool.save(question, "bucket", "nextRun")).toBeNull();
    const stored = (await database.doc("users/owner/examSessions/s").get()).data();
    expect(stored.deadline - stored.startedAt).toBe(90000);
    expect(stored.startedAt).toBeGreaterThan(1000);
    expect((await pool.history())).toHaveLength(1);
  });
  it("allows only one of two sessions to claim the same question", async () => {
    const saved = await pool.save(question, "bucket", "run");
    const results = await Promise.all([pool.commit(session("a", saved)), pool.commit(session("b", saved))]);
    expect(results.filter(r => r.ok)).toHaveLength(1);
    const sessions = await database.collection("users/owner/examSessions").get();
    expect(sessions.size).toBe(1);
  });
  it("denies cross-user and unauthenticated access without opening the server-only bank", async () => {
    const other = createQuestionPool("owner", "b", env.authenticatedContext("other").firestore());
    await assertFails(other.ready("bucket"));
    await assertFails(other.begin("run", {}));
    await assertFails(other.save(question, "bucket", "run"));
    await assertFails(createQuestionPool("owner", "b", env.unauthenticatedContext().firestore()).ready("bucket"));
    await assertFails(database.doc("users/owner/recognitionItems/x").set({ test: true }));
  });
});
