import {capacityKind} from '../../../providerCapacity.js';
import { questionSlot } from "./bpmBlueprint.js";
import { startBackgroundJob } from "../../backgroundJobs.js";
import { questionPreparationDeps } from "../../../questionPreparation.js";
import {hasReusableQuestionReview} from '../../../engine/questionReuse.js';
import {isSemanticDuplicate} from './questionQuality.js';
import {readSlot} from './bpmBlueprint.js';
import * as ratingsStore from '../../../stores/questionRatings.js';

export function missingRecoveryAllocation(session,blocked=[]){
 const questions=session.questions||[],missing=Math.max(0,Number(session.targetQuestionCount)-questions.length);
 const planned=session.fillPlan?.allocation||Object.fromEntries((session.lectureIds||[]).map(id=>[id,0]));
 const slots=Object.keys(planned).filter(id=>!blocked.includes(id)),allocation={};
 let left=missing;
 for(const id of slots){const count=Math.min(left,Math.max(0,Number(planned[id]||0)-questions.filter(q=>questionSlot(q)===id).length));if(count){allocation[id]=count;left-=count;}}
 // Prepared-reserve substitutions can satisfy a lecture quota while the full
 // requested set is still short. Reconcile against the actual session total.
 for(let i=0;left>0&&slots.length;i++,left--)allocation[slots[i%slots.length]]=(allocation[slots[i%slots.length]]||0)+1;
 return allocation;
}

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
export async function recoverExamPreparation({ session, userId, pool, generate, context, report = () => {}, manual = false }) {
  const key = `${userId}:${session.sessionId}`;
  if (!manual && session.format === 'exam' && session.startedAt != null) return;
  if (running.has(key) || session.fillLeaseUntil > Date.now()) {if(manual)throw new Error('Question preparation is already running. Your saved answers are unchanged.');return;}
  if(session.status !== 'in_progress')return;
  if (!manual && !["generating", "partial"].includes(session.fillStatus)) return;
  if (!manual && session.fillStatus === "partial" && !retryablePreparationFailure(session.fillError)) return;
  if (!manual && (session.fillRecoveryAttempts || 0) >= 3) return;
  const ids = session.lectureIds || [];
  if (!ids.length) return;
  const allocation = Object.fromEntries(ids.map(id => [id, (session.questions || []).filter(q => q.lectureId === id).length]));
  const missing = Math.max(0, session.targetQuestionCount - (session.questions || []).length);
  if (!missing) return;
  for (let i = 0; i < missing; i++) allocation[ids[i % ids.length]]++;
  const plan = session.fillPlan || { allocation, studyMode: session.studyMode || "balanced" };
  running.add(key);
  try {
    await waitForConnection();
    const claimed = await pool.claimSessionFill(session.sessionId, plan, { manual });
    if (!claimed) {if(manual)throw new Error('Could not claim this refill. Another worker may be preparing questions; refresh its status before retrying.');return;}
    const run = async reportJob => {
      // An empty model response is transport-like, not proof that the lecture
      // cannot support a valid question. Clear blocks left by the failed run
      // so only its missing slots are tried again after the bridge recovers.
      const working={...claimed,questions:[...(claimed.questions||[])]};
      // Use reviewed, unused reserve items in the ORIGINAL curriculum scope
      // before asking the model to retry the same failing final slots.
      const targeted=claimed.fillPlan.targetObjectiveIds?.length||claimed.fillPlan.studyMode==='repair'||claimed.blueprintExam||Object.keys(claimed.fillPlan.allocation).some(id=>id.includes('::bpm::'));
      if(manual&&!targeted)working.fillPlan={...claimed.fillPlan,allocation:{...Object.fromEntries((claimed.lectureIds||[]).map(id=>[id,0])),...claimed.fillPlan.allocation}};
      const previousBlocks=claimed.fillBlockedLectureIds||[];
      const canRedistribute=manual&&!targeted&&Object.keys(working.fillPlan.allocation).some(id=>!previousBlocks.includes(id));
      // Balanced exams may move failed slots to other ORIGINAL lecture slots.
      // Focused/blueprint exams keep their exact ownership and review targets.
      const blockedLectureIds=canRedistribute?previousBlocks:manual||emptyStructuredFailure(claimed.fillError)?[]:previousBlocks;
      if(manual&&!targeted&&pool.readyForLectures){
       const allowed=[...new Set([...claimed.lectureIds||[],...Object.keys(claimed.fillPlan.allocation).map(id=>readSlot(id).lectureId)])];
       const prior=[...(pool.history?await pool.history():[]),...working.questions];
       const reserve=await pool.readyForLectures(allowed);
       for(const q of reserve){
        if(working.questions.length>=claimed.targetQuestionCount)break;
        const linked=context.objectivesByLecture?.[q.lectureId]||[];
        if(!allowed.includes(q.lectureId)||q.blockId&&q.blockId!==claimed.blockId||!hasReusableQuestionReview(q)||ratingsStore.isExcluded(userId,q)||!q.objectiveIds?.some(id=>linked.some(o=>o.id===id||o.code===id))||(claimed.fillPlan.difficultyOverride&&q.difficulty!==claimed.fillPlan.difficultyOverride)||prior.some(old=>old.poolId===q.poolId||String(old.stem||'').toLowerCase().trim()===String(q.stem||'').toLowerCase().trim())||isSemanticDuplicate(q,prior))continue;
        const added=await pool.appendToSession(session.sessionId,q,{requestedCount:claimed.targetQuestionCount});
        if(added?.ok){working.questions.push(q);prior.push(q);const message=`${working.questions.length}/${claimed.targetQuestionCount} ready · added reviewed unused question`;reportJob(message);report(message);}
       }
      }
      const allocation = missingRecoveryAllocation(working,blockedLectureIds);
      if (!Object.keys(allocation).length) {
        await pool.finishSessionFill(session.sessionId, { requestedCount: claimed.targetQuestionCount });
        if(working.questions.length<claimed.targetQuestionCount)throw new Error(`${working.questions.length}/${claimed.targetQuestionCount} ready. No eligible lecture slots are available for the remainder.`);
        return "Ready questions are saved.";
      }
      let result;
      try {
        let sessionMutationQueue = Promise.resolve();
        const preparation = context.preparationPolicy || !context.callAIJSON
          ? context : { ...context, ...await questionPreparationDeps(context.callAIJSON, { allowCodexFallback: false }) };
        result = await generate({ ...context, ...claimed.fillPlan, allocation, existingQuestions:working.questions, userId, blockId: claimed.blockId, generationId: claimed.sessionId }, {
        ...preparation, pool,
        onProgress: progress => {
          report(progress.message); reportJob(progress.message);
          sessionMutationQueue = sessionMutationQueue.then(() => pool.reportSessionFillProgress(session.sessionId, progress)).catch(() => {});
        },
        onQuestionReady: q => {
          const append = sessionMutationQueue.then(async()=>{
            const saved=await pool.appendToSession(session.sessionId,q,{requestedCount:claimed.targetQuestionCount,durationMinutes:claimed.durationMinutes});
            if(!saved?.ok)throw new Error(`Reviewed question could not be added: ${saved?.reason||'storage did not confirm assignment'}`);
            return saved;
          });
          sessionMutationQueue = append.catch(() => {});
          return append;
        },
      });
        await sessionMutationQueue;
      } catch (error) { result = { errors: [{ message: error?.message || String(error) }] }; }
      const finished=await pool.finishSessionFill(session.sessionId, { requestedCount: claimed.targetQuestionCount, durationMinutes: claimed.durationMinutes,
        error: (result.errors || []).map(e => e.message).join(" "),
        blockedLectureIds: [...new Set([...blockedLectureIds, ...(result.errors || []).filter(e => blocksPreparationLecture(e.message)).map(e => e.lectureId).filter(Boolean)])] });
      if(finished?.questions?.length<claimed.targetQuestionCount)throw new Error(`${finished.questions.length}/${claimed.targetQuestionCount} questions saved. ${result.errors?.map(e=>e.message).join(' ')||'The last candidates did not pass review or assignment.'} Your existing answers are preserved.`);
      if(finished?.questions?.length>=claimed.targetQuestionCount)return 'All requested questions are saved. Your original answers are preserved.';
      if (result.errors?.length) throw new Error((result.errors||[]).map(e=>e.message).join(' ')+' Reviewed questions and existing answers remain saved.');
      return "Question preparation resumed and saved.";
    };
    await new Promise((resolve,reject) => startBackgroundJob({ label: "Resuming quiz questions", run: async reportJob => {
      try { const result=await run(reportJob);resolve(result);return result; } catch(error){
        await Promise.resolve(pool.finishSessionFill(session.sessionId,{requestedCount:claimed.targetQuestionCount,error:error.message||String(error)})).catch(()=>{});
        reject(error);throw error;
      }
    } }));
  } finally { running.delete(key); }
}
