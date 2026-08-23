import React, { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installDomStorage } from "../../../stores/testEnv.js";

// Tells React that act() is legitimate here; without it every act warns.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const getExamSessionMock = vi.fn();
const updateExamSessionTransactionMock = vi.fn();
const finalizeExamSessionMock = vi.fn();

// This hook's tests should not need the Firestore emulator — mock the
// Firestore-touching functions directly, the same DI approach
// useFocusHudSignal.test.jsx uses for its one dependency (examSessions has
// no localStorage-backed store to seed against, unlike useObjectivesController's
// dependencies).
vi.mock("../../../supabase.js", () => ({
  getExamSession: (...args) => getExamSessionMock(...args),
  updateExamSessionTransaction: (...args) => updateExamSessionTransactionMock(...args),
}));

vi.mock("./finalize.js", () => ({
  finalizeExamSession: (...args) => finalizeExamSessionMock(...args),
}));

const { useExamSessionController } = await import("./useExamSessionController.js");
const { mergeAnswer } = await import("../../../examSessions.js");

const USER = "u1";
const SESSION_ID = "sess-1";

function makeQuestion(questionId, letter = "A") {
  return {
    questionId,
    blockId: "b1",
    lectureId: "lec-1",
    objectiveIds: [],
    stem: `Stem ${questionId}`,
    choices: { A: "a", B: "b" },
    correct: letter,
    explanation: "because",
  };
}

function makeSession(overrides = {}) {
  return {
    schemaVersion: 1,
    sessionId: SESSION_ID,
    blockId: "b1",
    lectureIds: ["lec-1"],
    format: "exam",
    status: "in_progress",
    questions: [makeQuestion("q1"), makeQuestion("q2")],
    answers: [],
    sideEffectsCompleted: { statsRecordedQuestionIds: [], weakConceptsRecorded: false },
    startedAt: Date.now(),
    deadline: Date.now() + 60_000,
    submittedAt: null,
    rev: 0,
    ...overrides,
  };
}

/** Render the hook once and hand the caller a live-updating probe. */
function mountController(sessionId, userId) {
  let latest = null;
  let renders = 0;
  function Probe() {
    const controller = useExamSessionController(sessionId, userId);
    renders += 1;
    useEffect(() => {
      latest = controller;
    });
    return null;
  }
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  return {
    // One `act` call spanning the render AND the microtask hops the mount
    // effect's `load()` needs to resolve (mock promise -> await -> setState)
    // — splitting these across separate `act` calls leaves the later
    // setState outside any act scope and React warns.
    render: () =>
      act(async () => {
        root.render(<Probe />);
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      }),
    get: () => latest,
    get renderCount() {
      return renders;
    },
    unmount: () => act(() => root.unmount()),
  };
}

beforeEach(() => {
  installDomStorage();
  getExamSessionMock.mockReset();
  updateExamSessionTransactionMock.mockReset();
  finalizeExamSessionMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useExamSessionController", () => {
  it("loads the session on mount and exposes it", async () => {
    const session = makeSession();
    getExamSessionMock.mockResolvedValue(session);

    const probe = mountController(SESSION_ID, USER);
    await probe.render();
    // Flush the async load() microtask/effect.
    await act(async () => {});

    expect(getExamSessionMock).toHaveBeenCalledWith(USER, SESSION_ID);
    expect(probe.get().session).toEqual(session);
    expect(probe.get().loading).toBe(false);
    probe.unmount();
  });

  describe("timer", () => {
    it("derives remainingMs from the deadline and counts down over fake time", async () => {
      vi.useFakeTimers();
      const now = Date.now();
      const session = makeSession({ deadline: now + 10_000 });
      getExamSessionMock.mockResolvedValue(session);

      const probe = mountController(SESSION_ID, USER);
      await probe.render();
      await act(async () => {});

      expect(probe.get().remainingMs).toBeGreaterThan(9_000);
      expect(probe.get().remainingMs).toBeLessThanOrEqual(10_000);

      await act(async () => {
        vi.advanceTimersByTime(4_000);
      });

      expect(probe.get().remainingMs).toBeLessThanOrEqual(6_000);
      expect(probe.get().remainingMs).toBeGreaterThan(5_000);

      probe.unmount();
    });

    it("wires visibilitychange/focus to an immediate recompute that reflects true elapsed monotonic time, granting no extra free time", async () => {
      vi.useFakeTimers();
      const now = Date.now();
      const session = makeSession({ deadline: now + 10_000 });
      getExamSessionMock.mockResolvedValue(session);

      const probe = mountController(SESSION_ID, USER);
      await probe.render();
      await act(async () => {});

      // Clear the setInterval spy call count so we can prove the
      // visibilitychange listener — not a coincidental interval tick —
      // is what drives the next recompute.
      const before = probe.get().remainingMs;
      expect(before).toBeGreaterThan(9_000);

      // 8s of real (monotonic) time passes.
      await act(async () => {
        vi.advanceTimersByTime(8_000);
      });

      // Reconciliation via the event listener must reflect that elapsed
      // time immediately — not stay stale, and not overshoot beyond what
      // actually elapsed (the monotonic formula grants no free time).
      await act(async () => {
        document.dispatchEvent(new Event("visibilitychange"));
      });

      expect(probe.get().remainingMs).toBeLessThanOrEqual(2_000);
      expect(probe.get().remainingMs).toBeGreaterThan(1_000);

      // Firing the event again immediately (no further time elapsed) must
      // not change remainingMs further — proves it's a pure recompute of
      // real elapsed time, not an accumulator that grants time per event.
      const afterFirstReconcile = probe.get().remainingMs;
      await act(async () => {
        window.dispatchEvent(new Event("focus"));
      });
      expect(probe.get().remainingMs).toBeCloseTo(afterFirstReconcile, -2);

      probe.unmount();
    });

    it("auto-submits exactly once when remainingMs hits zero for format exam", async () => {
      vi.useFakeTimers();
      const now = Date.now();
      const session = makeSession({ deadline: now + 1_000 });
      getExamSessionMock.mockResolvedValue(session);
      finalizeExamSessionMock.mockResolvedValue({ ok: true });
      // The re-fetch submit() triggers after finalize — keep returning the
      // same (still in_progress-shaped) doc; what matters here is the call
      // count on finalizeExamSessionMock, not the post-finalize state.
      updateExamSessionTransactionMock.mockResolvedValue(session);

      const probe = mountController(SESSION_ID, USER);
      await probe.render();
      await act(async () => {});

      expect(finalizeExamSessionMock).not.toHaveBeenCalled();

      await act(async () => {
        vi.advanceTimersByTime(1_200);
      });
      // Let the microtask queue (submit()'s await finalizeExamSession + load()) flush.
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(finalizeExamSessionMock).toHaveBeenCalledTimes(1);
      expect(finalizeExamSessionMock).toHaveBeenCalledWith(USER, SESSION_ID, {});

      // Further timer ticks past zero must not trigger a second submit.
      await act(async () => {
        vi.advanceTimersByTime(2_000);
      });
      await act(async () => {
        await Promise.resolve();
      });

      expect(finalizeExamSessionMock).toHaveBeenCalledTimes(1);

      probe.unmount();
    });

    it("never auto-submits (and shows no countdown) for format practice", async () => {
      vi.useFakeTimers();
      const now = Date.now();
      // Even with a deadline field present, practice format must ignore it.
      const session = makeSession({ format: "practice", deadline: now + 1_000 });
      getExamSessionMock.mockResolvedValue(session);

      const probe = mountController(SESSION_ID, USER);
      await probe.render();
      await act(async () => {});

      expect(probe.get().remainingMs).toBeNull();

      await act(async () => {
        vi.advanceTimersByTime(5_000);
      });
      await act(async () => {
        await Promise.resolve();
      });

      expect(finalizeExamSessionMock).not.toHaveBeenCalled();
      probe.unmount();
    });
  });

  describe("answerQuestion", () => {
    it("updates local state optimistically and CAS-merges via the Firestore transaction", async () => {
      const session = makeSession();
      getExamSessionMock.mockResolvedValue(session);
      updateExamSessionTransactionMock.mockImplementation(async (userId, sessionId, updateFn) => {
        const next = updateFn(session);
        return next ? { ...next, status: "in_progress" } : session;
      });

      const probe = mountController(SESSION_ID, USER);
      await probe.render();
      await act(async () => {});

      let accepted;
      await act(async () => {
        accepted = probe.get().answerQuestion("q1", "A");
      });
      await act(async () => {
        await Promise.resolve();
      });

      expect(accepted).toBe(true);
      expect(probe.get().session.answers).toEqual([
        expect.objectContaining({ questionId: "q1", value: "A", seq: 0 }),
      ]);

      expect(updateExamSessionTransactionMock).toHaveBeenCalledTimes(1);
      const [calledUser, calledSessionId, updateFn] = updateExamSessionTransactionMock.mock.calls[0];
      expect(calledUser).toBe(USER);
      expect(calledSessionId).toBe(SESSION_ID);
      // The updateFn itself must implement mergeAnswer-by-questionId CAS
      // semantics, not a blind overwrite.
      const merged = updateFn(session);
      expect(merged.answers).toEqual(mergeAnswer(session.answers, merged.answers[0]));
    });

    it("vetoes and stops autosaving further answers once the session is no longer in_progress", async () => {
      const session = makeSession();
      getExamSessionMock.mockResolvedValue(session);
      // Simulate a finalize race: the transaction vetoes (returns the
      // unchanged current doc, whose status is no longer in_progress).
      updateExamSessionTransactionMock.mockResolvedValue({ ...session, status: "finalizing" });

      const probe = mountController(SESSION_ID, USER);
      await probe.render();
      await act(async () => {});

      await act(async () => {
        probe.get().answerQuestion("q1", "A");
      });
      await act(async () => {
        await Promise.resolve();
      });

      expect(updateExamSessionTransactionMock).toHaveBeenCalledTimes(1);

      // A second answer still updates local state (the hook's own session
      // copy is still "in_progress"), but must not call the transaction again.
      await act(async () => {
        probe.get().answerQuestion("q2", "B");
      });
      await act(async () => {
        await Promise.resolve();
      });

      expect(updateExamSessionTransactionMock).toHaveBeenCalledTimes(1);
      probe.unmount();
    });

    it("is a no-op once remainingMs has passed the deadline for format exam", async () => {
      vi.useFakeTimers();
      const now = Date.now();
      const session = makeSession({ deadline: now - 1_000, status: "in_progress" });
      getExamSessionMock.mockResolvedValue(session);
      finalizeExamSessionMock.mockResolvedValue({ ok: true });
      updateExamSessionTransactionMock.mockResolvedValue(session);

      const probe = mountController(SESSION_ID, USER);
      await probe.render();
      await act(async () => {});

      let accepted;
      await act(async () => {
        accepted = probe.get().answerQuestion("q1", "A");
      });

      expect(accepted).toBe(false);
      expect(updateExamSessionTransactionMock).not.toHaveBeenCalled();
      probe.unmount();
    });

    it("is a no-op once the session status is no longer in_progress", async () => {
      const session = makeSession({ status: "submitted" });
      getExamSessionMock.mockResolvedValue(session);

      const probe = mountController(SESSION_ID, USER);
      await probe.render();
      await act(async () => {});

      let accepted;
      await act(async () => {
        accepted = probe.get().answerQuestion("q1", "A");
      });

      expect(accepted).toBe(false);
      expect(updateExamSessionTransactionMock).not.toHaveBeenCalled();
      probe.unmount();
    });
  });

  describe("submit", () => {
    it("calls finalizeExamSession and re-fetches the session afterward", async () => {
      const session = makeSession();
      getExamSessionMock.mockResolvedValueOnce(session);
      finalizeExamSessionMock.mockResolvedValue({ ok: true });
      getExamSessionMock.mockResolvedValueOnce({ ...session, status: "submitted" });

      const probe = mountController(SESSION_ID, USER);
      await probe.render();
      await act(async () => {});

      let result;
      await act(async () => {
        result = await probe.get().submit();
      });

      expect(result).toEqual({ ok: true });
      expect(finalizeExamSessionMock).toHaveBeenCalledWith(USER, SESSION_ID, {});
      expect(getExamSessionMock).toHaveBeenCalledTimes(2);
      expect(probe.get().session.status).toBe("submitted");
      expect(probe.get().submitResult).toEqual({ ok: true });
      probe.unmount();
    });

    it("surfaces resumable:true from a failed finalize rather than swallowing it", async () => {
      const session = makeSession();
      getExamSessionMock.mockResolvedValue({ ...session, status: "finalizing" });
      finalizeExamSessionMock.mockResolvedValue({
        ok: false,
        error: "simulated failure",
        resumable: true,
      });

      const probe = mountController(SESSION_ID, USER);
      await probe.render();
      await act(async () => {});

      let result;
      await act(async () => {
        result = await probe.get().submit();
      });

      expect(result).toEqual({ ok: false, error: "simulated failure", resumable: true });
      expect(probe.get().submitResult).toEqual({
        ok: false,
        error: "simulated failure",
        resumable: true,
      });
      probe.unmount();
    });
  });

  describe("abandon", () => {
    it("transitions in_progress -> abandoned and never calls finalizeExamSession", async () => {
      const session = makeSession();
      getExamSessionMock.mockResolvedValue(session);
      updateExamSessionTransactionMock.mockImplementation(async (userId, sessionId, updateFn) => {
        const next = updateFn(session);
        return next;
      });

      const probe = mountController(SESSION_ID, USER);
      await probe.render();
      await act(async () => {});

      let result;
      await act(async () => {
        result = await probe.get().abandon();
      });

      expect(result.status).toBe("abandoned");
      expect(probe.get().session.status).toBe("abandoned");
      expect(finalizeExamSessionMock).not.toHaveBeenCalled();
      probe.unmount();
    });

    it("vetoes (returns null / leaves session alone) when the session isn't in_progress", async () => {
      const session = makeSession({ status: "submitted" });
      getExamSessionMock.mockResolvedValue(session);
      updateExamSessionTransactionMock.mockImplementation(async (userId, sessionId, updateFn) => {
        const next = updateFn(session);
        return next; // null, per the veto contract
      });

      const probe = mountController(SESSION_ID, USER);
      await probe.render();
      await act(async () => {});

      let result;
      await act(async () => {
        result = await probe.get().abandon();
      });

      expect(result).toBeNull();
      expect(probe.get().session.status).toBe("submitted");
      expect(finalizeExamSessionMock).not.toHaveBeenCalled();
      probe.unmount();
    });
  });

  describe("resume on mount", () => {
    it("surfaces a session already in 'finalizing' distinctly from in_progress", async () => {
      const session = makeSession({ status: "finalizing" });
      getExamSessionMock.mockResolvedValue(session);

      const probe = mountController(SESSION_ID, USER);
      await probe.render();
      await act(async () => {});

      expect(probe.get().session.status).toBe("finalizing");
      // The hook itself never auto-calls submit() for a resumed "finalizing"
      // session — that's the component's job (per the brief), not the
      // controller's.
      expect(finalizeExamSessionMock).not.toHaveBeenCalled();
      probe.unmount();
    });
  });
});
