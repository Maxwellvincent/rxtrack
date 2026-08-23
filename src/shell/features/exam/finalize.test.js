// @vitest-environment jsdom
// finalizeExamSession, exercised against the real Firestore emulator (same
// approach as firestoreAdapter.test.js / examSessionsSupabase.test.js —
// this repo has no vi.mock("firebase/firestore") pattern to follow).
import { describe, it, expect, beforeAll, vi } from "vitest";
import { createUserWithEmailAndPassword, signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "../../../firebase.js";
import {
  createExamSession,
  getExamSession,
  updateExamSessionTransaction,
} from "../../../supabase.js";
import { createSessionShape, withRecordedStats } from "../../../examSessions.js";
import { finalizeExamSession } from "./finalize.js";
import * as lectureQuestionStats from "../../../stores/lectureQuestionStats.js";

function makeQuestion(questionId, lectureId, correct = "A") {
  return { questionId, blockId: "block-1", lectureId, objectiveIds: [], stem: "?", choices: { A: "a", B: "b" }, correct, explanation: "" };
}

describe("finalizeExamSession", () => {
  let uid;
  beforeAll(async () => {
    try { await createUserWithEmailAndPassword(auth, "exam-finalize@d.com", "pw1234"); } catch {}
    const cred = await signInWithEmailAndPassword(auth, "exam-finalize@d.com", "pw1234");
    uid = cred.user.uid;
  });

  it("full happy path: in_progress -> finalizing -> submitted, both side effects recorded once", async () => {
    const sessionId = "sess-happy";
    const session = createSessionShape({
      sessionId,
      blockId: "block-happy",
      lectureIds: ["lec-1", "lec-2"],
      format: "exam",
      questions: [
        makeQuestion("q1", "lec-1", "A"),
        makeQuestion("q2", "lec-1", "A"),
        makeQuestion("q3", "lec-2", "A"),
      ],
      startedAt: Date.now(),
    });
    session.answers = [
      { questionId: "q1", value: "A", answeredAt: Date.now(), seq: 1, writerId: "w1" },
      { questionId: "q2", value: "B", answeredAt: Date.now(), seq: 1, writerId: "w1" },
      // q3 left unanswered on purpose.
    ];
    await createExamSession(uid, session);

    const result = await finalizeExamSession(uid, sessionId, { blockName: "Block Happy" });
    expect(result).toEqual({ ok: true });

    const finalDoc = await getExamSession(uid, sessionId);
    expect(finalDoc.status).toBe("submitted");
    expect(finalDoc.sideEffectsCompleted.weakConceptsRecorded).toBe(true);
    // Only answered questions get a stats call recorded; q3 is unanswered.
    expect(finalDoc.sideEffectsCompleted.statsRecordedQuestionIds.sort()).toEqual(["q1", "q2"]);
  });

  it("resumes from a session stuck in finalizing with one stats marker already true, without double-calling recordAnswerAwait for it", async () => {
    const sessionId = "sess-resume";
    const session = createSessionShape({
      sessionId,
      blockId: "block-resume",
      lectureIds: ["lec-1"],
      format: "exam",
      questions: [makeQuestion("q1", "lec-1", "A"), makeQuestion("q2", "lec-1", "A")],
      startedAt: Date.now(),
    });
    session.answers = [
      { questionId: "q1", value: "A", answeredAt: Date.now(), seq: 1, writerId: "w1" },
      { questionId: "q2", value: "A", answeredAt: Date.now(), seq: 1, writerId: "w1" },
    ];
    session.status = "finalizing";
    session.submittedAt = Date.now();
    session.sideEffectsCompleted = {
      statsRecordedQuestionIds: withRecordedStats([], "q1"),
      weakConceptsRecorded: false,
    };
    await createExamSession(uid, session);

    const spy = vi.spyOn(lectureQuestionStats, "recordAnswerAwait");

    const result = await finalizeExamSession(uid, sessionId, { blockName: "Block Resume" });
    expect(result).toEqual({ ok: true });

    // q1 was already recorded before this call; only q2 should have been
    // passed to recordAnswerAwait during this run.
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(uid, "lec-1", true);

    const finalDoc = await getExamSession(uid, sessionId);
    expect(finalDoc.status).toBe("submitted");
    expect(finalDoc.sideEffectsCompleted.statsRecordedQuestionIds.sort()).toEqual(["q1", "q2"]);

    spy.mockRestore();
  });

  it("calling finalize twice in a row (simulated crash mid-loop, then a real resume) never double-records a question", async () => {
    const sessionId = "sess-crash-resume";
    const session = createSessionShape({
      sessionId,
      blockId: "block-crash-resume",
      lectureIds: ["lec-1", "lec-2"],
      format: "exam",
      questions: [makeQuestion("q1", "lec-1", "A"), makeQuestion("q2", "lec-2", "A")],
      startedAt: Date.now(),
    });
    session.answers = [
      { questionId: "q1", value: "A", answeredAt: Date.now(), seq: 1, writerId: "w1" },
      { questionId: "q2", value: "A", answeredAt: Date.now(), seq: 1, writerId: "w1" },
    ];
    await createExamSession(uid, session);

    // First call: record q1 successfully, then make q2's call reject —
    // simulating a crash/network failure partway through the stats loop.
    const original = lectureQuestionStats.recordAnswerAwait;
    let callCount = 0;
    const failingSpy = vi
      .spyOn(lectureQuestionStats, "recordAnswerAwait")
      .mockImplementation(async (u, lectureId, wasCorrect) => {
        callCount++;
        if (callCount === 2) throw new Error("simulated crash mid-loop");
        return original(u, lectureId, wasCorrect);
      });

    const firstResult = await finalizeExamSession(uid, sessionId, { blockName: "Block Crash" });
    expect(firstResult.ok).toBe(false);
    expect(firstResult.resumable).toBe(true);

    const afterCrash = await getExamSession(uid, sessionId);
    expect(afterCrash.status).toBe("finalizing");
    // Exactly one question recorded before the simulated crash.
    expect(afterCrash.sideEffectsCompleted.statsRecordedQuestionIds).toEqual(["q1"]);

    failingSpy.mockRestore();

    // Second call: real recordAnswerAwait, tracked by a fresh spy — only the
    // still-pending question (q2) must be passed to it this time.
    const resumeSpy = vi.spyOn(lectureQuestionStats, "recordAnswerAwait");
    const secondResult = await finalizeExamSession(uid, sessionId, { blockName: "Block Crash" });
    expect(secondResult).toEqual({ ok: true });
    expect(resumeSpy).toHaveBeenCalledTimes(1);
    expect(resumeSpy).toHaveBeenCalledWith(uid, "lec-2", true);
    resumeSpy.mockRestore();

    const finalDoc = await getExamSession(uid, sessionId);
    expect(finalDoc.status).toBe("submitted");
    expect(finalDoc.sideEffectsCompleted.statsRecordedQuestionIds.sort()).toEqual(["q1", "q2"]);
  });

  it("calling on an already-submitted session returns {ok:true, alreadySubmitted:true} without touching it", async () => {
    const sessionId = "sess-already-submitted";
    const session = createSessionShape({
      sessionId,
      blockId: "block-submitted",
      lectureIds: ["lec-1"],
      format: "exam",
      questions: [makeQuestion("q1", "lec-1", "A")],
    });
    await createExamSession(uid, session);
    await updateExamSessionTransaction(uid, sessionId, (current) => ({
      ...current,
      status: "submitted",
      sideEffectsCompleted: { statsRecordedQuestionIds: ["q1"], weakConceptsRecorded: true },
    }));
    const before = await getExamSession(uid, sessionId);

    const result = await finalizeExamSession(uid, sessionId, { blockName: "Block Submitted" });
    expect(result).toEqual({ ok: true, alreadySubmitted: true });

    const after = await getExamSession(uid, sessionId);
    expect(after).toEqual(before);
  });

  it("calling on an abandoned session returns an error without mutating it", async () => {
    const sessionId = "sess-abandoned";
    const session = createSessionShape({
      sessionId,
      blockId: "block-abandoned",
      lectureIds: ["lec-1"],
      format: "exam",
      questions: [makeQuestion("q1", "lec-1", "A")],
    });
    await createExamSession(uid, session);
    await updateExamSessionTransaction(uid, sessionId, (current) => ({
      ...current,
      status: "abandoned",
    }));
    const before = await getExamSession(uid, sessionId);

    const result = await finalizeExamSession(uid, sessionId, { blockName: "Block Abandoned" });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/abandoned/);

    const after = await getExamSession(uid, sessionId);
    expect(after).toEqual(before);
  });

  it("returns an error for a session that does not exist", async () => {
    const result = await finalizeExamSession(uid, "does-not-exist-sess", {});
    expect(result).toEqual({ ok: false, error: "session not found" });
  });
});
