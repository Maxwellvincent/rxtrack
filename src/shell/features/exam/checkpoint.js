import { protectSessionScoring } from "../../../engine/questionScoringPolicy.js";
import { updateExamSessionTransaction } from "../../../supabase.js";
import { recordEvidenceBatchAwait } from "../../../stores/learnerEvidence.js";
import { linkSourceLecture } from "./questionBankLinks.js";
import { sessionEvidenceEvent } from "./sessionEvidence.js";

/** Publish completed work without ending the resumable session or its timer.
 * The snapshot is the scoring boundary: ordinary answer autosaves remain private
 * to the active exam until Save & exit or final submission. */
export async function checkpointExamSession(userId, sessionId, { lectures = [] } = {}) {
  const session = await updateExamSessionTransaction(userId, sessionId, current => {
    if (current?.status !== "in_progress") return null;
    return { ...current, progressSavedAt: Date.now(),
      checkpointAnswers: current.answers || [],
      questions: (current.questions || []).map(q => q.sourceType === "question-bank"
        ? linkSourceLecture(q, lectures, q.sourceBlockId || q.blockId || current.blockId) : q) };
  });
  if (!session || session.status !== "in_progress") throw new Error("This session could not be checkpointed. Please reload its status.");
  const questions = new Map((session.questions || []).map(q => [q.questionId, q]));
  const events = [];
  for (const answer of session.checkpointAnswers) {
    const question = questions.get(answer.questionId);
    if (!question || answer.value == null || !Object.hasOwn(question.choices || {}, answer.value)) continue;
    if (!question.lectureId && !question.objectiveIds?.length) continue;
    events.push(sessionEvidenceEvent(session, question, answer));
  }
  if (events.length) await recordEvidenceBatchAwait(userId, events);
  return session;
}

/** Keep pending picks out of dashboards; never count unanswered items. */
export function scoredSessionSnapshot(session, ratings = {}) {
  if (session.status === "submitted") return protectSessionScoring(session, ratings);
  if (session.status !== "in_progress" || !session.progressSavedAt) return null;
  return protectSessionScoring({ ...session, answers: session.checkpointAnswers || [], submittedAt: session.progressSavedAt, isCheckpoint: true }, ratings);
}
