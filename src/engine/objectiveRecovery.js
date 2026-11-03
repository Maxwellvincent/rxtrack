/** Recent recovery is practice evidence, never a prediction or proof of durable mastery. */
export const OBJECTIVE_RECOVERY_POLICY='2026-11-03-fresh-recovery';
export const RECOVERY_WINDOW=5;
const DAY=86400000;
export function objectiveRecovery(answers=[], latestCorrect=true) {
 const valid=answers.filter(a=>a.questionKey && typeof a.correct==='boolean' && Number.isFinite(a.at) && a.at>0);
 const distinct=new Map();for(const answer of valid)if(!distinct.has(answer.questionKey))distinct.set(answer.questionKey,answer);
 const window=[...distinct.values()].sort((a,b)=>a.at-b.at).slice(-RECOVERY_WINDOW);
 const correct=window.filter(a=>a.correct);
 const applications=correct.filter(a=>a.reasoningVerified===true && ['second-order','third-order'].includes(a.orderLevel));
 const sessions=new Set(correct.map(a=>a.sessionKey).filter(Boolean));
 const tasks=new Set(correct.map(a=>a.taskType).filter(Boolean));
 const spaced=correct.some(a=>correct.some(b=>a.sessionKey && b.sessionKey && a.sessionKey!==b.sessionKey && Math.abs(a.at-b.at)>=DAY));
 return {policy:OBJECTIVE_RECOVERY_POLICY,window,count:window.length,correct:correct.length,
  recovered:window.length===RECOVERY_WINDOW && correct.length>=4 && latestCorrect && window.at(-1)?.correct===true
   && sessions.size>=2 && tasks.size>=2 && applications.length>=2 && spaced};
}
/** Optimistic lower bound only: future answers must actually meet all diversity/depth/time checks. */
export function minimumRecoveryQuestions(answers=[],latestCorrect=true) {
 for(let additional=0;additional<=RECOVERY_WINDOW;additional++){
  const at=Math.max(1,...answers.map(a=>Number(a.at)||0));
  const future=Array.from({length:additional},(_,i)=>({questionKey:`future:${i}`,correct:true,at:at+(i+1)*DAY,
   sessionKey:`future-session:${i}`,taskType:`future-task:${i%2}`,orderLevel:'second-order',reasoningVerified:true}));
  if(objectiveRecovery([...answers,...future],additional>0 || latestCorrect).recovered)return additional;
 }
 return RECOVERY_WINDOW;
}
