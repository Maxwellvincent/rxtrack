/**
 * Task 10 — Tutor mode: cache, dedupe, soft-cancel hook.
 *
 * Wraps `explainQuestion` (tutorMode.js) with:
 * - a cache keyed by `questionId` (Task 5 stamps a unique `questionId` on
 *   every generated question — used directly as the cache key, no
 *   content-hashing needed).
 * - in-flight de-duplication (a second `request()` for the same
 *   `questionId` while one's already in flight awaits the same promise
 *   rather than firing a second `callAI` call).
 * - "soft" cancellation of stale responses: `callAI` has no `AbortSignal`
 *   support in this codebase (src/aiClient.js), so a response that lands
 *   after the component unmounted, or after `request()` was called again for
 *   a *different* questionId, is dropped instead of overwriting state for
 *   whatever's on screen now.
 *
 * Cache lives in a MODULE-LEVEL Map (not a ref) deliberately: it needs to
 * survive across mounts within the same page session — e.g. Format A's
 * review screen re-visiting a question already tutor-explained earlier in
 * the session shouldn't re-request. A per-hook-instance ref would reset on
 * every unmount/remount as the user navigates between questions, defeating
 * that reuse.
 *
 * Final-review fix C2 — only SUCCESSFUL results (`{text}`) are cached here.
 * An `{error}` result (e.g. `callAI is not a function` when no transport was
 * supplied, or a genuine transient failure) is intentionally never written
 * to `resultCache`, so a subsequent `request()` call for a previously-failed
 * questionId finds nothing cached and naturally retries — no separate
 * "clear the cache" API needed, and no stale error can get stuck forever.
 *
 * On-demand only: this hook never fetches on mount or when `question`
 * changes — it only ever calls `explainQuestion` from inside `request()`,
 * which the caller (TutorPanel via its `onRequest`, or ExamSessionRunner in
 * a later task) invokes explicitly on reveal.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { explainQuestion } from "./tutorMode.js";

// Module-level: settled results, keyed by questionId.
const resultCache = new Map();
// Module-level: in-flight promises, keyed by questionId — this is what
// makes de-dup work across concurrent request() calls (and across hook
// instances, which is harmless: the same question, same answer).
const inFlightByQuestionId = new Map();

export function useTutorExplanation(question, { enabled = true } = {}, deps = {}) {
  const [text, setText] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const mountedRef = useRef(true);
  // The questionId this hook instance's visible state should currently
  // reflect. Updated synchronously (via effect, before any user-triggered
  // request()) whenever `question` changes — a response for any other id is
  // stale and must not touch state.
  const currentQuestionIdRef = useRef(question?.questionId ?? null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Question identity changed: adopt whatever's cached (instant, no
  // network), and clear any leftover text/error from a prior question. This
  // is NOT a fetch — no explainQuestion call happens here.
  useEffect(() => {
    const questionId = question?.questionId ?? null;
    currentQuestionIdRef.current = questionId;
    const cached = questionId ? resultCache.get(questionId) : null;
    setText(cached?.text ?? null);
    setError(cached?.error ?? null);
    setLoading(false);
  }, [question?.questionId]);

  const request = useCallback(() => {
    const questionId = question?.questionId;
    if (!questionId || !enabled) return Promise.resolve(null);

    const cached = resultCache.get(questionId);
    if (cached) {
      if (mountedRef.current && currentQuestionIdRef.current === questionId) {
        setText(cached.text ?? null);
        setError(cached.error ?? null);
        setLoading(false);
      }
      return Promise.resolve(cached);
    }

    let promise = inFlightByQuestionId.get(questionId);
    if (!promise) {
      promise = explainQuestion(question, deps).then((result) => {
        // Only cache success — see the module doc's C2 fix note above. An
        // `{error}` result is deliberately left uncached so the next
        // request() for this questionId retries instead of replaying it.
        if (!result?.error) resultCache.set(questionId, result);
        inFlightByQuestionId.delete(questionId);
        return result;
      });
      inFlightByQuestionId.set(questionId, promise);
    }

    if (mountedRef.current && currentQuestionIdRef.current === questionId) {
      setLoading(true);
      setError(null);
    }

    promise.then((result) => {
      // Soft-cancel: drop this response if the component's gone, or the
      // user has since moved to a different question.
      if (!mountedRef.current) return;
      if (currentQuestionIdRef.current !== questionId) return;
      setLoading(false);
      setText(result?.text ?? null);
      setError(result?.error ?? null);
    });

    return promise;
  }, [question, enabled, deps]);

  return { text, loading, error, request };
}
