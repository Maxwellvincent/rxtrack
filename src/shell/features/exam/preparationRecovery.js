import {capacityKind} from '../../../providerCapacity.js';
import { questionSlot } from "./bpmBlueprint.js";
import { startBackgroundJob } from "../../backgroundJobs.js";
import { questionPreparationDeps } from "../../../questionPreparation.js";

const running = new Set();
export function holdPreparationWorker(userId, sessionId) {
  const key = `${userId}:${sessionId}`; running.add(key);
  return () => running.delete(key);
}
export const connectionFailure = message => !capacityKind(message) && /timed?\s*out|timeout|network|offline|failed to fetch|unavailable|connection/i.test(String(message || ""));
const emptyStructuredFailure = message => /empty reply|returned no text|empty or invalid json|not valid or repairable json|invalid json|bridge 5\d\d/i.test(String(message || ""));
export const retryablePreparationFailure = message => connectionFailure(message) || emptyStructuredFailure(message);
export const blocksPreparationLecture=message=>!capacityKind(message) && !retryablePreparationFailure(message);
export function waitForConnection() {
  if (typeof navigator === "undefined" || navigator.onLine !== false) return Promise.resolve();
  return new Promise(resolve => window.addEventListener("online", resolve, { once: true }));
}

// The plan lives on the session; browser memory only prevents duplicate workers
// in this tab. Firestore's lease prevents two tabs resuming the same attempt.
export async function recoverExamPreparation({ session, userId, pool, generate, context, report = () => {} }) {
  const key = `${userId}:${session.sessionId}`;
  if (running.has(key) || session.status !== "in_progress" || session.fillLeaseUntil > Date.now()) return;
  if (!["generating", "partial"].includes(session.fillStatus)) return;
  if (session.fillStatus === "partial" && !retryablePreparationFailure(session.fillError)) return;
  if ((session.fillRecoveryAttempts || 0) >= 3) return;
  const ids = session.lectureIds || [];
  if (!ids.length) return;
  const allocation = Object.fromEntries(ids.map(id => [id, (session.questions || []).filter(q => q.lectureId === id).length]));
  const missing = Math.max(0, session.targetQuestionCount - (session.questions || []).length);
  for (let i = 0; i < missing; i++) allocation[ids[i % ids.length]]++;
  const plan = session.fillPlan || { allocation, studyMode: session.studyMode || "balanced" };
  running.add(key);
  try {
    await waitForConnection();
    const claimed = await pool.claimSessionFill(session.sessionId, plan);
    if (!claimed) return;
    const run = async reportJob => {
      // An empty model response is transport-like, not proof that the lecture
      // cannot support a valid question. Clear blocks left by the failed run
      // so only its missing slots are tried again after the bridge recovers.
      const blockedLectureIds = emptyStructuredFailure(claimed.fillError) ? [] : (claimed.fillBlockedLectureIds || []);
      const allocation = Object.fromEntries(Object.entries(claimed.fillPlan.allocation).map(([id, count]) => [id,
        Math.max(0, count - (claimed.questions || []).filter(q => questionSlot(q) === id).length)]).filter(([id, count]) => count && !blockedLectureIds.includes(id)));
      if (!Object.keys(allocation).length) {
        await pool.finishSessionFill(session.sessionId, { requestedCount: claimed.targetQuestionCount });
        return "Ready questions are saved.";
      }
      let result;
      try {
        let sessionMutationQueue = Promise.resolve();
        const preparation = context.preparationPolicy || !context.callAIJSON
          ? context : { ...context, ...await questionPreparationDeps(context.callAIJSON, { allowCodexFallback: false }) };
        result = await generate({ ...context, ...claimed.fillPlan, allocation, userId, blockId: claimed.blockId, generationId: claimed.sessionId }, {
        ...preparation, pool,
        onProgress: progress => {
          report(progress.message); reportJob(progress.message);
          sessionMutationQueue = sessionMutationQueue.then(() => pool.reportSessionFillProgress(session.sessionId, progress)).catch(() => {});
        },
        onQuestionReady: q => {
          const append = sessionMutationQueue.then(() => pool.appendToSession(session.sessionId, q, { requestedCount: claimed.targetQuestionCount, durationMinutes: claimed.durationMinutes }));
          sessionMutationQueue = append.catch(() => {});
          return append;
        },
      });
        await sessionMutationQueue;
      } catch (error) { result = { errors: [{ message: error?.message || String(error) }] }; }
      await pool.finishSessionFill(session.sessionId, { requestedCount: claimed.targetQuestionCount, durationMinutes: claimed.durationMinutes,
        error: (result.errors || []).map(e => e.message).join(" "),
        blockedLectureIds: [...new Set([...blockedLectureIds, ...(result.errors || []).filter(e => blocksPreparationLecture(e.message)).map(e => e.lectureId).filter(Boolean)])] });
      if (result.errors?.length) throw new Error("Some missing questions still need preparation. Reviewed questions remain saved.");
      return "Question preparation resumed and saved.";
    };
    await new Promise(resolve => startBackgroundJob({ label: "Resuming quiz questions", run: async reportJob => {
      try { return await run(reportJob); } finally { resolve(); }
    } }));
  } finally { running.delete(key); }
}
