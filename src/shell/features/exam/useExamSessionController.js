/**
 * Task 6 — the Integrated Exam session runtime: the controller hook.
 *
 * Given an existing `in_progress` (or resuming `finalizing`) session, this
 * hook is the whole runtime for running it to completion: load the session,
 * run the countdown timer (format "exam" only), collect answers with
 * optimistic local updates + CAS-merged autosave, and call
 * `finalizeExamSession` (Task 7) on manual submit or timeout.
 *
 * This hook does NOT create sessions (Task 8's job) and does NOT compute
 * scores (Task 7's `finalizeExamSession` does that from `session.answers`
 * vs `session.questions` when it runs `recordAnswerAwait`).
 *
 * `examSessions` (unlike the `cloudBase.js`-backed stores) has no live-
 * subscription primitive — this hook does a one-time fetch on mount/id
 * change plus its own re-fetch after each mutating call, matching the
 * pattern documented in the task brief rather than a `useSyncExternalStore`
 * subscription (there's nothing to subscribe to).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getExamSession, updateExamSessionTransaction } from "../../../supabase.js";
import { mergeAnswer } from "../../../examSessions.js";
import { finalizeExamSession } from "./finalize.js";

function newWriterId() {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `w_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

export function useExamSessionController(sessionId, userId) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [syncStatus, setSyncStatus] = useState("synced"); // "pending" | "synced" | "error"
  const [submitting, setSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState(null);
  // Bumped by the timer interval / visibilitychange / focus reconciliation to
  // force `remainingMs` to recompute; carries no data of its own.
  const [tick, setTick] = useState(0);

  const mountedRef = useRef(false);
  // Monotonic baseline: `performance.now()` is immune to wall-clock jumps
  // (system clock changes, sleep/wake) once the component has been mounted
  // continuously. Right at mount, elapsed is 0 and the formula below reduces
  // to `mountWallRef.current` — i.e. the wall-clock deadline — which is the
  // documented, accepted fallback for the instant right after mount/reload
  // (a clock rollback exactly then could extend a session by a few seconds;
  // low-stakes for a self-practice tool, not solved further here).
  const mountWallRef = useRef(0);
  const mountPerfRef = useRef(0);
  const writerIdRef = useRef(null);
  const seqRef = useRef(0);
  const autoSubmitTriggeredRef = useRef(false);
  const autosaveStoppedRef = useRef(false);

  if (writerIdRef.current == null) writerIdRef.current = newWriterId();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const doc = await getExamSession(userId, sessionId);
      if (!mountedRef.current) return doc;
      setSession(doc);
      return doc;
    } catch (e) {
      if (!mountedRef.current) return null;
      setError(e?.message || String(e));
      return null;
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [userId, sessionId]);

  useEffect(() => {
    mountedRef.current = true;
    autoSubmitTriggeredRef.current = false;
    autosaveStoppedRef.current = false;
    seqRef.current = 0;
    mountWallRef.current = Date.now();
    mountPerfRef.current = performance.now();
    setCurrentIndex(0);
    setSubmitResult(null);
    setSyncStatus("synced");
    load();
    return () => {
      mountedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `load` itself
    // is derived from [userId, sessionId], so re-running on those is enough.
  }, [userId, sessionId]);

  // Timer: format "exam" only, only while the session is actually running.
  useEffect(() => {
    if (!session) return;
    if (session.format !== "exam") return;
    if (session.status !== "in_progress") return;
    if (session.deadline == null) return;

    const bump = () => setTick((t) => t + 1);
    const id = setInterval(bump, 250);
    document.addEventListener("visibilitychange", bump);
    window.addEventListener("focus", bump);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", bump);
      window.removeEventListener("focus", bump);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the
    // primitives below should re-arm the timer; `session` itself changes
    // identity on every optimistic answer merge and would otherwise thrash
    // the interval/listeners for no reason.
  }, [session?.format, session?.status, session?.deadline]);

  const remainingMs = useMemo(() => {
    if (!session) return null;
    if (session.format !== "exam") return null;
    if (session.deadline == null) return null;
    const elapsed = performance.now() - mountPerfRef.current;
    const estimatedNow = mountWallRef.current + elapsed;
    return session.deadline - estimatedNow;
    // `tick` is a deliberate dependency purely to force recomputation on
    // each timer/visibility/focus pulse; it carries no value itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.format, session?.deadline, tick]);

  const submit = useCallback(
    async (opts = {}) => {
      setSubmitting(true);
      try {
        const result = await finalizeExamSession(userId, sessionId, opts);
        if (mountedRef.current) setSubmitResult(result);
        await load();
        return result;
      } finally {
        if (mountedRef.current) setSubmitting(false);
      }
    },
    [userId, sessionId, load]
  );

  // Auto-submit exactly once when the clock runs out on a still-running
  // "exam" session. Guarded by a ref so re-renders (e.g. from the optimistic
  // answer-merge below) never re-trigger it.
  useEffect(() => {
    if (!session) return;
    if (session.format !== "exam") return;
    if (session.status !== "in_progress") return;
    if (remainingMs == null || remainingMs > 0) return;
    if (autoSubmitTriggeredRef.current) return;
    autoSubmitTriggeredRef.current = true;
    submit();
  }, [remainingMs, session, submit]);

  // Answers lock at expiry (format "exam" only) or once the session is no
  // longer "in_progress" — not at render time. Returns `false` synchronously
  // (rather than throwing/rejecting) when the answer is refused; callers
  // that care can branch on the return value.
  const answerQuestion = useCallback(
    (questionId, value) => {
      if (!session) return false;
      if (session.status !== "in_progress") return false;
      if (session.format === "exam" && (remainingMs == null || remainingMs <= 0)) return false;

      const answer = {
        questionId,
        value,
        answeredAt: Date.now(),
        seq: seqRef.current++,
        writerId: writerIdRef.current,
      };

      // Optimistic local update — the UI shouldn't wait on a round trip.
      setSession((prev) => (prev ? { ...prev, answers: mergeAnswer(prev.answers, answer) } : prev));

      if (autosaveStoppedRef.current) return true;

      setSyncStatus("pending");
      updateExamSessionTransaction(userId, sessionId, (current) => {
        if (!current || current.status !== "in_progress") return null;
        return { ...current, answers: mergeAnswer(current.answers, answer) };
      })
        .then((result) => {
          if (!mountedRef.current) return;
          // The transaction hands back either the applied write (status
          // still "in_progress", answers merged) or the unchanged current
          // doc when the updateFn vetoed (session isn't "in_progress"
          // anymore — e.g. a finalize race). Only the former counts as a
          // real sync; the latter means stop trying for this instance.
          if (!result || result.status !== "in_progress") {
            autosaveStoppedRef.current = true;
            return;
          }
          setSyncStatus("synced");
        })
        .catch(() => {
          if (mountedRef.current) setSyncStatus("error");
        });

      return true;
    },
    [session, remainingMs, userId, sessionId]
  );

  // in_progress -> abandoned. Never calls finalizeExamSession — an abandoned
  // session must never enter finalization.
  const abandon = useCallback(async () => {
    const result = await updateExamSessionTransaction(userId, sessionId, (current) => {
      if (!current || current.status !== "in_progress") return null;
      return { ...current, status: "abandoned" };
    });
    if (mountedRef.current && result) setSession(result);
    return result;
  }, [userId, sessionId]);

  return {
    session,
    loading,
    error,
    currentIndex,
    setCurrentIndex,
    remainingMs,
    syncStatus,
    submitting,
    submitResult,
    answerQuestion,
    submit,
    abandon,
    refetch: load,
  };
}
