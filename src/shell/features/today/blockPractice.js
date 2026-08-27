export function blockPracticeSummary(blockId, lectures = [], stats = {}, sessions = []) {
  const ids = new Set(lectures.filter((l) => l.blockId === blockId).map((l) => l.id));
  let answered = 0, correct = 0;
  for (const id of ids) {
    answered += Math.max(0, Number(stats[id]?.answered) || 0);
    correct += Math.max(0, Number(stats[id]?.correct) || 0);
  }
  const timed = [];
  const seen = new Set();
  for (const session of sessions) {
    if (session.blockId !== blockId || seen.has(session.sessionId)) continue;
    seen.add(session.sessionId);
    const recorded = new Set(session.sideEffectsCompleted?.statsRecordedQuestionIds || []);
    const answers = new Map((session.answers || []).map((a) => [a.questionId, a]));
    let sessionCorrect = 0;
    for (const q of session.questions || []) {
      const answer = answers.get(q.questionId);
      const attempted = answer?.value != null && answer.value !== "";
      const right = attempted && answer.value === q.correct;
      const alreadyCounted = ids.has(q.lectureId) && q.sourceType !== "question-bank" && recorded.has(q.questionId);
      // Exam finalization records unanswered items as incorrect. The volume
      // metric counts answers actually attempted; exam scores still include skips.
      if (alreadyCounted && !attempted) answered -= 1;
      if (!alreadyCounted && attempted) { answered += 1; correct += right ? 1 : 0; }
      sessionCorrect += right ? 1 : 0;
    }
    if (session.status === "submitted" && session.format === "exam" && session.questions?.length) {
      timed.push({ at: session.submittedAt || 0, correct: sessionCorrect, total: session.questions.length });
    }
  }
  answered = Math.max(0, answered);
  correct = Math.min(answered, Math.max(0, correct));
  const recent = timed.sort((a, b) => b.at - a.at).slice(0, 5);
  const recentTotal = recent.reduce((n, s) => n + s.total, 0);
  return { answered, correct, accuracy: answered ? correct / answered : null,
    timedCount: recent.length, timedQuestions: recentTotal,
    timedAccuracy: recentTotal ? recent.reduce((n, s) => n + s.correct, 0) / recentTotal : null };
}
