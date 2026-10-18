import { expect, it, vi } from "vitest";
import { recoverExamPreparation, waitForConnection, holdPreparationWorker } from "./preparationRecovery.js";
const session = { sessionId: "s", blockId: "b", status: "in_progress", fillStatus: "partial", fillError: "AI request timed out", targetQuestionCount: 3, lectureIds: ["l"], questions: [{ lectureId: "l" }], fillPlan: { allocation: { l: 3 } } };
it("resumes only missing slots and keeps rejected quality items excluded", async () => {
 const pool = { claimSessionFill: vi.fn(async () => ({ ...session, fillBlockedLectureIds: ["bad"], fillPlan: { allocation: { l: 3, bad: 2 } } })), finishSessionFill: vi.fn(), appendToSession: vi.fn(), reportSessionFillProgress: vi.fn() };
 const generate = vi.fn(async () => ({ questions: [], errors: [{ lectureId: "l", message: "weak_explanation" }] }));
 await recoverExamPreparation({ session, userId: "u", pool, generate, context: {} });
 expect(generate.mock.calls[0][0].allocation).toEqual({ l: 2 });
 expect(pool.finishSessionFill.mock.calls[0][1].blockedLectureIds).toEqual(["bad", "l"]);
});
it("does not automatically retry quality failures or exhausted recovery attempts", async () => {
 const pool = { claimSessionFill: vi.fn() };
 for (const patch of [{ fillError: "reviewer rejected weak_explanation" }, { fillRecoveryAttempts: 3 }]) {
  await recoverExamPreparation({ session: { ...session, ...patch }, userId: "u", pool });
 }
 expect(pool.claimSessionFill).not.toHaveBeenCalled();
});

it("waits offline and wakes on reconnect", async () => {
 const events = new EventTarget();
 vi.stubGlobal("navigator", { onLine: false }); vi.stubGlobal("window", events);
 try {
  const done = vi.fn(); const waiting = waitForConnection().then(done);
  await Promise.resolve(); expect(done).not.toHaveBeenCalled();
  events.dispatchEvent(new Event("online")); await waiting;
  expect(done).toHaveBeenCalledOnce();
 } finally { vi.unstubAllGlobals(); }
});
it("does not launch recovery beside an existing live worker", async () => {
 const release = holdPreparationWorker("u", "s"); const pool = { claimSessionFill: vi.fn() };
 try { await recoverExamPreparation({ session, userId: "u", pool }); expect(pool.claimSessionFill).not.toHaveBeenCalled(); }
 finally { release(); }
});
