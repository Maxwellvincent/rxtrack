import { questionEvidenceKey } from '../stores/learnerEvidence.js';
import { canonicalObjectiveIds } from './objectiveLinks.js';
import { sessionEvidenceEvent } from '../shell/features/exam/sessionEvidence.js';

/** Recover only explicit, current-catalog links. No topic guessing or lecture-wide credit. */
export function auditAnswerHistory({blockId, objectives=[], evidence={}, calibration=[], sessions=[], excluded=()=>false}) {
 const journal=evidence.evidenceJournal || [];
 const updates=new Map();
 const summary={answersInspected:0, recoveredAnswers:0, repairedLinks:0, alreadyRecorded:0, needsLinking:0, excluded:0, legacyReviewedWithoutAnswers:0};
 const candidates=[];
 for(const session of sessions){
  if(session.blockId!==blockId || !['submitted','in_progress','finalizing'].includes(session.status))continue;
  // Timed exam answers are not graded before submission/checkpoint.
  if(session.format==='exam' && session.status!=='submitted' && !session.progressSavedAt)continue;
  for(const answer of session.answers || []){
   const q=(session.questions || []).find(q=>q.questionId===answer.questionId);
   if(!q || !answer.value || !q.correct || !(answer.value in (q.choices || {})))continue;
   candidates.push(sessionEvidenceEvent(session,q,answer));
  }
 }
 for(const record of calibration){
  if(typeof record.correct!=='boolean')continue;
  candidates.push({...record, at:record.ts || record.at,blockId,source:'quiz',sessionKey:record.sessionKey || `legacy-quiz:${blockId}`,questionKey:record.questionKey,objectiveIds:record.objectiveIds || []});
 }
 for(const candidate of candidates){
  if(candidate.blockId!==blockId)continue;
  summary.answersInspected++;
  if(excluded(candidate)){summary.excluded++;continue;}
  const ids=canonicalObjectiveIds(candidate.objectiveIds,objectives);
  const key=questionEvidenceKey(candidate.questionKey);
  if(!ids.length || !key){summary.needsLinking++;continue;}
  const existing=journal.filter(event=>event.blockId===blockId && questionEvidenceKey(event.questionKey)===key);
  const match=existing.find(event=>event.eventId && event.eventId===candidate.eventId)
    || existing.find(event=>event.sessionKey===candidate.sessionKey)
    || existing.find(event=>Math.abs(Number(event.at)-Number(candidate.at))<2000);
  if(match){
   const added=ids.filter(id=>!(match.objectiveIds || []).includes(id));
   if(!added.length){summary.alreadyRecorded++;continue;}
   const eventId=match.eventId || `history:${blockId}:${key}:${match.at}`;
   updates.set(eventId,{...match,eventId,objectiveIds:[...new Set([...(match.objectiveIds || []),...ids])],historyReconciled:true});
   summary.repairedLinks++;
  }else if(existing.length || evidence.objectives && ids.every(id=>evidence.objectives[id]?.questionKeys?.includes(key))){
   // An old log without stable session/time cannot safely establish another attempt.
   summary.alreadyRecorded++;
  }else{
   const eventId=candidate.eventId || `history:${blockId}:${key}:${candidate.at || 'legacy'}`;
   if(updates.has(eventId))continue;
   updates.set(eventId,{...candidate,eventId,questionKey:key,objectiveIds:ids,historyReconciled:true});
   summary.recoveredAnswers++;
  }
 }
 summary.legacyReviewedWithoutAnswers=objectives.filter(o=>(o.reviewStatus || o.status) && (o.reviewStatus || o.status)!=='untested' && !(evidence.objectives?.[o.id]?.attempts || o.attempts || o.totalAttempts)).length;
 return {summary,events:[...updates.values()]};
}
