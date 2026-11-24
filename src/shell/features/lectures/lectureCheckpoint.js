import {withDeadline} from '../../../asyncDeadline.js';
import {questionReferencesVisual} from '../../../engine/questionVisual.js';
import {createSessionShape} from '../../../examSessions.js';
import {createExamSession,listExamSessions} from '../../../firebaseData.js';
import {prepareObjectiveQuiz,buildAdaptiveObjectivePlan} from '../objectives/quizLaunch.js';
import {questionPreparationDeps} from '../../../questionPreparation.js';
import {callAIJSON} from '../../../aiClient.js';
import * as generated from '../../../stores/generatedQuestions.js';
import {hasReusableQuestionReview,isReusableForObjective} from '../../../engine/questionReuse.js';
import {areNearDuplicateQuestions,exceedsAnswerConcentration} from '../../../engine/questionSimilarity.js';
import {isIndependentAttempt} from '../../../engine/practiceAssistance.js';
import {stableRecordId} from '../../../engine/sourceUse.js';
export const LECTURE_CHECKPOINT_POLICY='2026-11-23-independent-lecture';
export const isLectureCheckpoint=s=>s?.purpose==='lecture-checkpoint';
const active=new Map();
export function launchLectureCheckpoint(args,deps={}){
 const key=`${args.userId}:${args.lecture?.id}`;if(active.has(key))return active.get(key);
 const work=launch(args,deps).finally(()=>active.delete(key));active.set(key,work);return work;
}
async function checkpointPool(userId,signal){
 generated.read(userId);
 await withDeadline(inner=>new Promise((resolve,reject)=>{
  let off=()=>{},done=false;
  const finish=error=>{if(done)return;done=true;off();inner.removeEventListener('abort',abort);if(error)reject(error);else resolve();};
  const abort=()=>finish(inner.reason||new Error('Checkpoint preparation stopped.'));
  const check=()=>{const error=generated.readError(userId);if(error)finish(error);else{generated.read(userId);if(generated.isHydrated(userId))finish();}};
  off=generated.subscribe(()=>queueMicrotask(check));inner.addEventListener('abort',abort,{once:true});check();
 }),15000,signal,'Loading saved question exposure');
 return Object.entries(generated.read(userId)||{}).flatMap(([lectureId,entry])=>(entry.questions||[]).map(q=>q.lectureId?q:{...q,lectureId}));
}
async function launch(args,deps){
 const {userId,blockId,lecture,objectives=[],questionCount=10,onProgress,signal}=args;
 if(!userId||!lecture?.id||!objectives.length)return {ok:false,error:'Sign in and load the lecture objectives before starting a checkpoint.'};
 const count=Number(questionCount);if(![5,10,20].includes(count))return {ok:false,error:'Choose 5, 10 or 20 checkpoint questions.'};
 signal?.throwIfAborted();
 const history=await (deps.listSessions||listExamSessions)(userId,null);
 signal?.throwIfAborted();
 if(!Array.isArray(history))throw new Error('Checkpoint history could not be verified. Retry before starting a new assessment.');
 const prior=(history||[]).filter(s=>s.blockId===blockId&&isLectureCheckpoint(s)&&s.lectureIds?.includes(lecture.id)&&['in_progress','finalizing'].includes(s.status)).sort((a,b)=>(b.createdAt||b.startedAt||0)-(a.createdAt||a.startedAt||0))[0];
 if(prior)return {ok:true,sessionId:prior.sessionId,resumed:true};
 const pool=deps.readQuestions?deps.readQuestions(userId):await checkpointPool(userId,signal);
 const seen=[...(history||[]).flatMap(s=>s.questions||[]),...pool.filter(q=>!generated.isQuestionUnseen(q)),...(args.exemplars||[])];
 const plan=buildAdaptiveObjectivePlan(objectives,count),quotas=new Map(plan.map(o=>[String(o.id||o.code),o._targetQuestionCount]));
 const safeFigure=q=>!(q.hasImage||q.imageDependent||q.image||q.sourceImageUrl||questionReferencesVisual(q.stem))||q.sourceFigureCropped===true&&!!q.sourceImageUrl;
 const eligible=q=>safeFigure(q)&&q.lectureId===lecture.id&&hasReusableQuestionReview(q)&&generated.isQuestionUnseen(q)&&isIndependentAttempt(q)&&['second-order','third-order'].includes(q.orderLevel)&&!seen.some(old=>areNearDuplicateQuestions(q,old));
 const ready=[];
 for(const q of pool.filter(eligible)){
  const target=plan.find(o=>q.objectiveIds?.includes(o.id||o.code)&&isReusableForObjective(q,o));const id=target&&(target.id||target.code);
  if(!id||!quotas.get(id)||ready.some(other=>areNearDuplicateQuestions(q,other))||exceedsAnswerConcentration(q,ready,count))continue;
  ready.push(q);quotas.set(id,quotas.get(id)-1);if(ready.length===count)break;
 }
 const save=deps.saveQuestions||generated.addQuestions,flush=deps.flushQuestions||generated.flushPendingWrites;
 let result={questions:[]};
 if(ready.length<count){
  const ai=deps.preparationDeps||await questionPreparationDeps(callAIJSON,{allowCodexFallback:false});
  result=await (deps.prepare||prepareObjectiveQuiz)({...args,lectureIdHint:lecture.id,lectureTitle:lecture.lectureTitle||lecture.title,lectureText:args.lectureText,initialQuestions:ready,plannedCount:count,questionCount:count-ready.length,generationVersion:'v2',reasoningPolicy:'challenge',avoidQuestions:seen,avoidStems:seen.map(q=>q.stem).filter(Boolean),focusNotes:'INDEPENDENT LECTURE CHECKPOINT: Cover the supplied objective allocation using fresh second-order application and supported third-order integration. No hints, teaching in the stem, recycled school cases or familiar-answer shortcuts. Match the clinical level and discrimination of the supplied ExamSoft, IMCQ, in-class and homework examples.'},{...ai,signal,onAccepted:items=>save(userId,lecture.id,items)},onProgress);
 }
 signal?.throwIfAborted();
 const questions=[...ready,...(result.questions||[])].filter((q,i,all)=>safeFigure(q)&&hasReusableQuestionReview(q)&&isIndependentAttempt(q)&&['second-order','third-order'].includes(q.orderLevel)&&q.objectiveIds?.some(id=>objectives.some(o=>o.id===id))&&!seen.some(old=>areNearDuplicateQuestions(q,old))&&!all.slice(0,i).some(old=>areNearDuplicateQuestions(q,old))).slice(0,count);
 if(result.questions?.length)save(userId,lecture.id,result.questions);
 await flush();
 if(questions.length<count)return {ok:false,ready:questions.length,requested:count,error:`${questions.length}/${count} independently reviewed checkpoint questions are ready. ${result.reason||result.error||'Choose a shorter checkpoint or retry the missing questions.'}`};
 const sessionId=crypto.randomUUID(),at=Date.now();
 const session={...createSessionShape({sessionId,blockId,lectureIds:[lecture.id],format:'exam',title:`${lecture.lectureTitle||lecture.title||'Lecture'} · Independent checkpoint`,contentScope:'lecture-checkpoint',targetQuestionCount:count,durationMinutes:count*1.5,questions:questions.map((q,i)=>({...q,questionId:`checkpoint:${sessionId}:${i+1}`,questionKey:q.questionKey||q.poolId||stableRecordId(q.stem,'question'),blockId,lectureId:lecture.id}))}),purpose:'lecture-checkpoint',createdAt:at,checkpoint:{policy:LECTURE_CHECKPOINT_POLICY,lectureId:lecture.id,knownPriorExposure:0,externalExposure:'unknown',feedback:'after-submission',requestedOrderCounts:plan.map(o=>({objectiveId:o.id,order:o._targetOrder,count:o._targetQuestionCount}))}};
 signal?.throwIfAborted();
 const saved=await (deps.createSession||createExamSession)(userId,session);
 if(!saved?.ok)return {ok:false,error:saved?.error||'Checkpoint could not be saved. Your reviewed questions remain ready.'};
 // Reserve issued questions conservatively without recording an answer or a presentation.
 (deps.reserveQuestions||generated.reserveCheckpointQuestions)(userId,lecture.id,questions,sessionId,at);
 await flush();
 return {ok:true,sessionId,questionCount:count};
}
