// @vitest-environment jsdom
// examSessions CRUD + transaction primitive, exercised against the real
// Firestore emulator (same approach as firestoreAdapter.test.js — this repo
// has no vi.mock("firebase/firestore") pattern to follow).
import { describe, it, expect, beforeAll } from "vitest";
import { createUserWithEmailAndPassword, signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "./firebase";
import {
  createExamSession,
  getExamSession,
  listExamSessions,
  updateExamSessionTransaction,
} from "./supabase";
import { createSessionShape, MAX_EXAM_SESSION_BYTES } from "./examSessions";

describe("examSessions Firestore CRUD + transaction", () => {
  let uid;
  beforeAll(async () => {
    try { await createUserWithEmailAndPassword(auth, "exam-sessions@d.com", "pw1234"); } catch {}
    const cred = await signInWithEmailAndPassword(auth, "exam-sessions@d.com", "pw1234");
    uid = cred.user.uid;
  });

  it("createExamSession then getExamSession round-trips the full document", async () => {
    const session = createSessionShape({
      sessionId: "sess-1",
      blockId: "block-1",
      lectureIds: ["lec-1"],
      format: "exam",
      questions: [{ questionId: "q1" }],
    });

    const res = await createExamSession(uid, session);
    expect(res).toEqual({ ok: true });

    const got = await getExamSession(uid, "sess-1");
    expect(got).toMatchObject({
      sessionId: "sess-1",
      blockId: "block-1",
      format: "exam",
      status: "in_progress",
      rev: 0,
    });
  });

  it("getExamSession returns null for a session that doesn't exist", async () => {
    const got = await getExamSession(uid, "does-not-exist");
    expect(got).toBeNull();
  });

  it("createExamSession rejects an oversized session without writing", async () => {
    const bigStem = "x".repeat(MAX_EXAM_SESSION_BYTES + 1000);
    const session = createSessionShape({
      sessionId: "sess-oversized",
      blockId: "block-1",
      format: "practice",
      questions: [{ questionId: "q1", stem: bigStem }],
    });

    const res = await createExamSession(uid, session);
    expect(res.ok).toBe(false);
    expect(res.error).toBe("session too large");

    const got = await getExamSession(uid, "sess-oversized");
    expect(got).toBeNull();
  });

  it("listExamSessions filters by blockId, and optionally by status", async () => {
    await createExamSession(
      uid,
      createSessionShape({ sessionId: "sess-a", blockId: "block-list", format: "exam" })
    );
    await createExamSession(
      uid,
      createSessionShape({ sessionId: "sess-b", blockId: "block-list", format: "practice" })
    );
    await createExamSession(
      uid,
      createSessionShape({ sessionId: "sess-c", blockId: "other-block", format: "exam" })
    );
    // Move sess-b to "submitted" via the transaction primitive so the status
    // filter has something to distinguish.
    await updateExamSessionTransaction(uid, "sess-b", (current) => ({
      ...current,
      status: "submitted",
    }));

    const forBlock = await listExamSessions(uid, "block-list");
    const ids = forBlock.map((s) => s.sessionId).sort();
    expect(ids).toEqual(["sess-a", "sess-b"]);

    const submittedOnly = await listExamSessions(uid, "block-list", { status: "submitted" });
    expect(submittedOnly.map((s) => s.sessionId)).toEqual(["sess-b"]);
  });

  it("updateExamSessionTransaction applies updateFn and increments rev", async () => {
    await createExamSession(
      uid,
      createSessionShape({ sessionId: "sess-tx", blockId: "block-tx", format: "exam" })
    );

    const result = await updateExamSessionTransaction(uid, "sess-tx", (s) => ({ ...s, foo: "bar" }));
    expect(result.foo).toBe("bar");
    expect(result.rev).toBe(1);

    const got = await getExamSession(uid, "sess-tx");
    expect(got.foo).toBe("bar");
    expect(got.rev).toBe(1);

    // A second update increments rev again from the persisted value.
    const result2 = await updateExamSessionTransaction(uid, "sess-tx", (s) => ({ ...s, foo: "baz" }));
    expect(result2.rev).toBe(2);
  });

  it("updateExamSessionTransaction leaves the doc unchanged when updateFn vetoes with null", async () => {
    await createExamSession(
      uid,
      createSessionShape({ sessionId: "sess-veto", blockId: "block-veto", format: "exam" })
    );
    const before = await getExamSession(uid, "sess-veto");

    const result = await updateExamSessionTransaction(uid, "sess-veto", () => null);
    expect(result).toMatchObject({ sessionId: "sess-veto", rev: 0 });

    const after = await getExamSession(uid, "sess-veto");
    expect(after.rev).toBe(before.rev);
    expect(after).toEqual(before);
  });
});
