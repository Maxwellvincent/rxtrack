/**
 * Integrated Exam sessions: pure local logic, no Firestore I/O.
 *
 * One `examSessions` document per block-wide timed mini-exam (or practice
 * run). Mirrors the role `deepLearnSessions.js` plays for DeepLearn: this
 * file owns the schema shape and pure merge/CAS logic; `src/supabase.js`
 * owns the actual Firestore reads/writes (see the "EXAM SESSIONS" section
 * there).
 *
 * Document shape — the FULL Firestore document body, no `{data: ...}`
 * wrapper (unlike the `state`/`mcq` docs), because a later dashboard task
 * needs to query top-level `blockId` + `status` together:
 *
 * ```js
 * {
 *   schemaVersion: 1,
 *   sessionId: string,           // also the Firestore doc id (encodeDocId'd)
 *   blockId: string,
 *   lectureIds: string[],
 *   format: "exam" | "practice",
 *   status: "in_progress" | "finalizing" | "submitted" | "abandoned",
 *   questions: [
 *     { questionId: string, blockId: string, lectureId: string, objectiveIds: string[],
 *       stem: string, choices: { [letter: string]: string }, correct: string,
 *       explanation: string }
 *     // shape TBD precisely by generation (later task) — treated as opaque here.
 *   ],
 *   answers: [
 *     { questionId: string, value: string, answeredAt: number, seq: number, writerId: string }
 *   ],
 *   sideEffectsCompleted: {
 *     statsRecordedQuestionIds: string[],
 *     weakConceptsRecorded: boolean,
 *   },
 *   startedAt: number | null,   // set only once generation completes (later task)
 *   deadline: number | null,    // startedAt + durationMs, format "exam" only
 *   submittedAt: number | null,
 *   rev: number,                // incremented on every write via updateExamSessionTransaction
 *   updatedAt: <Firestore serverTimestamp()>,
 * }
 * ```
 */

// Firestore's real per-doc cap is ~1 MiB; same guard threshold as
// src/supabase.js's MAX_DOC_BYTES.
export const MAX_EXAM_SESSION_BYTES = 900_000;

export function sessionBytes(session) {
  try {
    return JSON.stringify(session ?? null).length;
  } catch {
    return 0;
  }
}

/**
 * Pure constructor for a brand-new exam session. Does not touch Firestore —
 * the caller passes the result to `createExamSession` (src/supabase.js) to
 * persist it.
 */
export function createSessionShape({
  sessionId,
  blockId,
  lectureIds,
  format,
  questions,
  startedAt = null,
  deadline = null,
}) {
  return {
    schemaVersion: 1,
    sessionId,
    blockId,
    lectureIds: lectureIds ?? [],
    format,
    status: "in_progress",
    questions: questions ?? [],
    answers: [],
    sideEffectsCompleted: {
      statsRecordedQuestionIds: [],
      weakConceptsRecorded: false,
    },
    startedAt,
    deadline,
    submittedAt: null,
    rev: 0,
  };
}

/**
 * CAS-merge-by-questionId: given the current `answers` array and one
 * incoming answer, return a new array where the incoming answer replaces
 * the existing one for that `questionId` only if it wins the deterministic
 * ordering (answeredAt desc, then seq desc, then writerId lexicographically
 * desc). If there's no existing answer for that questionId, it's added.
 * Pure function — no Firestore involved.
 */
export function mergeAnswer(currentAnswers, incomingAnswer) {
  const answers = currentAnswers ?? [];
  const idx = answers.findIndex((a) => a.questionId === incomingAnswer.questionId);
  if (idx === -1) return [...answers, incomingAnswer];

  const existing = answers[idx];
  const incomingWins =
    incomingAnswer.answeredAt !== existing.answeredAt
      ? incomingAnswer.answeredAt > existing.answeredAt
      : incomingAnswer.seq !== existing.seq
      ? incomingAnswer.seq > existing.seq
      : incomingAnswer.writerId > existing.writerId;

  if (!incomingWins) return answers;

  const next = answers.slice();
  next[idx] = incomingAnswer;
  return next;
}
