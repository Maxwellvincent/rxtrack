import {linkSourceLecture} from './questionBankLinks.js';
/** Reconcile saved/checkpoint answers with legacy lecture counters, without
 * adding a mirrored session twice. Outside totals cannot be assigned a lecture. */
export function reconcileLectureStats(stats={},sessions=[],lectures=[],blockId){
 const next=Object.fromEntries(Object.entries(stats).map(([id,row])=>[id,{...row}]));
 const detailed=new Map(),seen=new Set();
 for(const session of sessions){
  if(session.blockId!==blockId||seen.has(session.sessionId))continue;
  seen.add(session.sessionId);
  const recorded=new Set(session.sideEffectsCompleted?.statsRecordedQuestionIds||[]);
  const answers=new Map((session.answers||[]).map(a=>[a.questionId,a]));
  for(const before of session.questions||[]){
   const q=before.sourceType==='question-bank'?linkSourceLecture(before,lectures,blockId):before;
   const answer=answers.get(q.questionId);
   if(!q.lectureId||!lectures.some(l=>l.id===q.lectureId&&(!l.blockId||l.blockId===blockId))||!Object.hasOwn(q.choices||{},q.correct)||!Object.hasOwn(q.choices||{},answer?.value))continue;
   const right=Number(answer.value===q.correct);
   const detail=detailed.get(q.lectureId)||{answered:0,correct:0};detail.answered++;detail.correct+=right;detailed.set(q.lectureId,detail);
   const row=next[q.lectureId]||{answered:0,correct:0};
   const checkpointCounted=row.checkpointEventIds?.includes(`exam:${session.sessionId}:${q.questionId}`);
   if(!recorded.has(q.questionId)&&!checkpointCounted&&(session.isCheckpoint||!before.lectureId))next[q.lectureId]={...row,answered:(Number(row.answered)||0)+1,correct:(Number(row.correct)||0)+right};
  }
 }
 for(const [id,detail] of detailed)if(detail.answered>(Number(next[id]?.answered)||0))next[id]={...next[id],...detail};
 return next;
}
