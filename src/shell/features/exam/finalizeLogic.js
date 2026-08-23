/**
 * Integrated Exam finalization: pure logic, no I/O.
 *
 * `finalize.js` (the orchestrator, in this same directory) owns all the
 * Firestore reads/writes and calls into these functions for every decision
 * that doesn't need I/O — stats-pending detection, per-lecture scoring, and
 * the weak-concept mastery-level resolution. Keeping this logic pure is what
 * makes it fast/thorough to unit-test and safe to re-run on a resumed
 * finalization without side effects of its own.
 */

import { hasRecordedStats } from "../../../examSessions.js";

/**
 * `questionId`s present in `session.answers` but not yet reflected in
 * `session.sideEffectsCompleted.statsRecordedQuestionIds`. A question with
 * no answer at all is not "pending stats" — it never gets a
 * `recordAnswer` call, answered or not.
 */
export function pendingStatsQuestionIds(session) {
  const answers = session?.answers || [];
  const recorded = session?.sideEffectsCompleted?.statsRecordedQuestionIds || [];
  return answers
    .filter((a) => !hasRecordedStats(recorded, a.questionId))
    .map((a) => a.questionId);
}

/**
 * `{ questionCount, misses }` for one session + one lecture. Unanswered
 * counts as a miss, same as a wrong answer — matches the plan's scoring
 * rule that no signal either way still counts against the lecture.
 */
export function evaluateSessionForLecture(session, lectureId) {
  const questions = (session?.questions || []).filter((q) => q.lectureId === lectureId);
  if (questions.length === 0) return { questionCount: 0, misses: 0 };

  const answers = session?.answers || [];
  let misses = 0;
  for (const q of questions) {
    const answer = answers.find((a) => a.questionId === q.questionId);
    const wasCorrect = !!answer && answer.value === q.correct;
    if (!wasCorrect) misses++;
  }
  return { questionCount: questions.length, misses };
}

/**
 * Consecutive "clean" sessions for `lectureId`, walking `sessionsDescByRecency`
 * (caller's responsibility to have already sorted most-recent-first) from the
 * start. A session with zero questions for this lecture is skipped — no
 * evidence either direction — without breaking the streak. The streak ends
 * at the first session with `questionCount > 0` that is not clean
 * (`misses / questionCount < 0.4`).
 */
export function computeCleanSessionStreak(sessionsDescByRecency, lectureId) {
  let streak = 0;
  for (const session of sessionsDescByRecency || []) {
    const { questionCount, misses } = evaluateSessionForLecture(session, lectureId);
    if (questionCount === 0) continue;
    const isClean = misses / questionCount < 0.4;
    if (!isClean) break;
    streak++;
  }
  return streak;
}

/**
 * Full per-lecture weak-concept decision: cumulative flagging + streak
 * recovery combined into one replacement-or-null result. A pure lookup from
 * the streak/cumulative counts computed fresh from `sessions` every call —
 * never an increment off `existingEntry`'s stored `masteryLevel`. Calling
 * this twice with identical inputs must produce byte-identical output.
 */
export function computeWeakConceptEntry({
  sessions,
  blockId,
  blockName,
  lectureId,
  lectureLabel,
  existingEntry,
  now,
}) {
  const sortedSessions = [...(sessions || [])].sort(
    (a, b) => (b?.submittedAt ?? 0) - (a?.submittedAt ?? 0)
  );

  let totalQuestions = 0;
  let totalMisses = 0;
  for (const session of sortedSessions) {
    const { questionCount, misses } = evaluateSessionForLecture(session, lectureId);
    totalQuestions += questionCount;
    totalMisses += misses;
  }
  const cumulativeMissRate = totalQuestions > 0 ? totalMisses / totalQuestions : 0;

  const consecutiveCleanSessions = computeCleanSessionStreak(sortedSessions, lectureId);

  let masteryLevel = null;
  if (consecutiveCleanSessions >= 4) {
    masteryLevel = "mastered";
  } else if (consecutiveCleanSessions >= 2) {
    masteryLevel = "developing";
  } else if (totalQuestions >= 3 && cumulativeMissRate >= 0.4) {
    masteryLevel = "struggling";
  }

  if (masteryLevel === null) return null;

  return {
    id: `exam:${blockId}:${lectureId}`,
    concept: lectureLabel || lectureId,
    description: `Integrated Exam: ${totalMisses}/${totalQuestions} missed across sessions`,
    angle: "general",
    blockId,
    blockName,
    linkedLecIds: [lectureId],
    lectureLabels: [lectureLabel || lectureId],
    objectiveIds: [],
    missCount: totalMisses,
    lastMissed: now,
    lastCorrect: consecutiveCleanSessions > 0 ? now : existingEntry?.lastCorrect ?? null,
    consecutiveCorrect: consecutiveCleanSessions,
    totalAttempts: totalQuestions,
    masteryLevel,
    questionHistory: existingEntry?.questionHistory ?? [],
    sourceQuestions: existingEntry?.sourceQuestions ?? [],
    dateFirstSeen: existingEntry?.dateFirstSeen ?? now,
    tags: ["integrated-exam"],
  };
}
