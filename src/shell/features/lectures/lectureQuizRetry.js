/**
 * A short lecture quiz ("8/10 ready") must continue the SAME saved session when
 * the learner retries or starts with what is ready. Rebuilding a new session
 * from those questions reset progress to question 1 and dropped saved answers.
 */
export function savedSessionForPending(pending, sessions = []) {
  if (!pending?.sessionId) return null;
  return sessions.find(session => session?.id === pending.sessionId && session.questions?.length) || null;
}

/** What the "N/M questions ready" panel should do for a given button. */
export function pendingQuizAction(pending, sessions = [], button = "retry") {
  const saved = savedSessionForPending(pending, sessions);
  if (button === "start") return saved ? { type: "resume", session: { ...saved, requestedCount: saved.questions.length } } : { type: "new", questions: pending?.questions || [] };
  return saved ? { type: "resume-and-prepare", session: saved, count: pending.count } : { type: "prepare", count: pending?.count, questions: pending?.questions || [] };
}
