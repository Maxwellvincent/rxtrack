/**
 * Integrated Exam finalization: the I/O orchestrator.
 *
 * Turns a frozen `in_progress` session into `submitted`, recording per-
 * lecture stats and weak-concept entries along the way. Every step is
 * resumable — calling `finalizeExamSession` again after any failure picks
 * up wherever the previous call left off, driven entirely by state already
 * persisted on the session document (`sideEffectsCompleted`) and by
 * re-deriving the weak-concept entries fresh each time from queryable
 * session data (see `finalizeLogic.js`'s `computeWeakConceptEntry` — pure,
 * deterministic, never an increment off stored state).
 */

import {
  updateExamSessionTransaction,
  getExamSession,
  listExamSessions,
} from "../../../supabase.js";
import { recordAnswerAwait } from "../../../stores/lectureQuestionStats.js";
import { read as readWeakConcepts, writeAwait as writeWeakConceptsAwait } from "../../../stores/weakConcepts.js";
import { mergeExamReportConcepts } from "../../logic/examReportWeakConcepts.js";
import { withRecordedStats } from "../../../examSessions.js";
import { pendingStatsQuestionIds, computeWeakConceptEntry } from "./finalizeLogic.js";
import { recordEvidenceAwait } from "../../../stores/learnerEvidence.js";
import { classifyLeadIn } from "./questionReading.js";
import { releaseUnansweredQuestions } from "../../../questionPool.js";

export async function finalizeExamSession(
  userId,
  sessionId,
  { blockName = "", lectureLabelsByLectureId = {} } = {}
) {
  // Step 1: lock via CAS transition in_progress -> finalizing.
  const lockResult = await updateExamSessionTransaction(userId, sessionId, (current) => {
    if (!current || current.status !== "in_progress") return null;
    return { ...current, status: "finalizing", submittedAt: Date.now() };
  });

  if (lockResult === null) {
    return { ok: false, error: "session not found" };
  }

  // `updateExamSessionTransaction` returns the doc it actually wrote, whether
  // that was the transition to "finalizing" (applied) or the unchanged
  // current doc (vetoed because status wasn't "in_progress"). Either way its
  // `status` field alone tells us what to do next — no need to re-fetch:
  //   - "finalizing": either just locked by us, or a legitimate resume of a
  //     session already stuck here from a prior partial run. Both proceed
  //     to step 2 identically.
  //   - "submitted": idempotent — finalize was already completed.
  //   - "abandoned": not finalizable.
  //   - "in_progress" here would mean the veto fired despite status being
  //     "in_progress", which the updateFn above cannot produce.
  if (lockResult.status === "submitted") {
    return { ok: true, alreadySubmitted: true };
  }
  if (lockResult.status === "abandoned") {
    return { ok: false, error: "session is abandoned, cannot finalize" };
  }
  if (lockResult.status !== "finalizing") {
    return { ok: false, error: `unexpected session status: ${lockResult.status}` };
  }

  const session = lockResult;

  // Step 2: resume-safe stats recording, in sequence.
  const pending = pendingStatsQuestionIds(session);
  for (const questionId of pending) {
    const question = session.questions.find((q) => q.questionId === questionId);
    const answer = session.answers.find((a) => a.questionId === questionId);
    const wasCorrect = !!answer && answer.value === question?.correct;

    try {
      // Authentic uploaded banks are not reliably linked to one RXtrack
      // lecture. Keep their score/timing in the session without creating a
      // fake "undefined" lecture statistic or weak-concept entry.
      if (question?.sourceType !== "question-bank" && question?.lectureId) {
        await recordAnswerAwait(userId, question.lectureId, wasCorrect);
        await recordEvidenceAwait(userId, {
          source: "integrated-exam",
          blockId: session.blockId,
          lectureId: question.lectureId,
          objectiveIds: question?.objectiveIds || [],
          atomKey: question?.atomKey || null,
          correct: wasCorrect,
          difficulty: question?.difficulty || null,
          misconception: wasCorrect ? null : "exam-error",
          responseMs: answer?.responseMs,
          answerChanges: answer?.answerChanges || 0,
          taskType: classifyLeadIn(question?.stem),
        });
      }
    } catch (e) {
      return { ok: false, error: e?.message || String(e), resumable: true };
    }

    try {
      await updateExamSessionTransaction(userId, sessionId, (current) =>
        current
          ? {
              ...current,
              sideEffectsCompleted: {
                ...current.sideEffectsCompleted,
                statsRecordedQuestionIds: withRecordedStats(
                  current.sideEffectsCompleted.statsRecordedQuestionIds,
                  questionId
                ),
              },
            }
          : null
      );
    } catch (e) {
      return { ok: false, error: e?.message || String(e), resumable: true };
    }
  }

  // Step 3: weak-concept write, once.
  const latest = await getExamSession(userId, sessionId);
  if (!latest) {
    return { ok: false, error: "session not found" };
  }

  if (!latest.sideEffectsCompleted.weakConceptsRecorded) {
    const lectureIds = [...new Set(latest.questions.map((q) => q.lectureId).filter(Boolean))];
    const allSubmitted = await listExamSessions(userId, latest.blockId, { status: "submitted" });
    const sessionsForCalc = [
      ...allSubmitted.filter((s) => s.sessionId !== latest.sessionId),
      latest,
    ];

    const store = (await readWeakConcepts(userId)) || {};
    let blockConcepts = store[latest.blockId] || [];

    for (const lectureId of lectureIds) {
      const existingEntry = blockConcepts.find(
        (c) => c.id === `exam:${latest.blockId}:${lectureId}`
      );
      const entry = computeWeakConceptEntry({
        sessions: sessionsForCalc,
        blockId: latest.blockId,
        blockName,
        lectureId,
        lectureLabel: lectureLabelsByLectureId[lectureId],
        existingEntry,
        now: new Date().toISOString(),
      });
      if (entry) {
        blockConcepts = mergeExamReportConcepts(blockConcepts, [entry]);
      }
    }

    try {
      await writeWeakConceptsAwait(userId, { ...store, [latest.blockId]: blockConcepts });
    } catch (e) {
      return { ok: false, error: e?.message || String(e), resumable: true };
    }

    try {
      await updateExamSessionTransaction(userId, sessionId, (current) =>
        current
          ? {
              ...current,
              sideEffectsCompleted: { ...current.sideEffectsCompleted, weakConceptsRecorded: true },
            }
          : null
      );
    } catch (e) {
      return { ok: false, error: e?.message || String(e), resumable: true };
    }
  }

  // Step 4: final flip to submitted.
  let finalDoc;
  try {
    finalDoc = await updateExamSessionTransaction(userId, sessionId, (current) => {
      if (!current) return null;
      if (!current.sideEffectsCompleted.weakConceptsRecorded) return null;
      return { ...current, status: "submitted" };
    });
  } catch (e) {
    return { ok: false, error: e?.message || String(e), resumable: true };
  }

  // The transaction can hand back a doc whose status isn't "submitted" in
  // two cases: the veto fired (doc deleted concurrently, or the safety-net
  // condition — weakConceptsRecorded still false — somehow held), or the
  // doc genuinely doesn't exist any more. Either way that must not be
  // reported as success.
  if (!finalDoc || finalDoc.status !== "submitted") {
    return { ok: false, error: "failed to flip session to submitted", resumable: true };
  }

  try {
    await releaseUnansweredQuestions(userId, finalDoc);
  } catch (e) {
    return { ok: false, error: e?.message || String(e), resumable: true };
  }

  return { ok: true };
}
