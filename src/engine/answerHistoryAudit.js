import {recoverAnswerSource} from './answerHistorySources.js';
import { questionEvidenceKey } from '../stores/learnerEvidence.js';
import { canonicalObjectiveIds } from './objectiveLinks.js';
import { sessionEvidenceEvent } from '../shell/features/exam/sessionEvidence.js';

const compactEvent=event=>Object.fromEntries(['eventId','source','sessionKey','blockId','lectureId','objectiveIds','questionKey','atomKey','correct','confidence','difficulty','misconception','responseMs','answerChanges','taskType','orderLevel','reasoningVerified','questionNumber','at','learningContext'].filter(key=>event[key]!==undefined).map(key=>[key,event[key]]));

/** Recover only explicit, current-catalog links. No topic guessing or lecture-wide credit. */
export function auditAnswerHistory({blockId, objectives=[], evidence={}, calibration=[], sessions=[], sourceQuestions=[], excluded=()=>false}) {
 const journal=evidence.evidenceJournal || [];
 const updates=new Map();
 const summary={answersInspected:0, recoveredAnswers:0, repairedLinks:0, alreadyRecorded:0, needsLinking:0, excluded:0, legacyReviewedWithoutAnswers:0};
 const candidates=[];
 const unresolved=[];
 const origins=new Map();
 for(const session of sessions){
  if(session.blockId!==blockId || !['submitted','in_progress','finalizing'].includes(session.status))continue;
  // Timed exam answers are not graded before submission/checkpoint.
  if(session.format==='exam' && session.status!=='submitted' && !session.progressSavedAt)continue;
  for(const answer of session.answers || []){
   const q=(session.questions || []).find(q=>q.questionId===answer.questionId);
   if(!q || !answer.value || !q.correct || !(answer.value in (q.choices || {})))continue;
   candidates.push({...sessionEvidenceEvent(session,q,answer),stem:q.stem,lectureLabel:q.lectureLabel,sourceFile:session.sourceFile || q.sourceFile || session.title || "Saved exam/practice session",origin:"Saved school/exam session",originSessionId:session.sessionId});
  }
 }
 for(const record of calibration){
  if(typeof record.correct!=='boolean')continue;
  candidates.push({...record, at:record.ts || record.at,blockId,source:'quiz',origin:'Lecture-quiz answer log',sourceFile:record.sourceFile || 'Lecture-quiz answer log',sessionKey:record.sessionKey || `legacy-quiz:${blockId}`,questionKey:record.questionKey,objectiveIds:record.objectiveIds || []});
 }
 for(const original of candidates){
  const {record:candidate,basis}=recoverAnswerSource(original,sourceQuestions,objectives);
  const origin=original.sourceFile || original.origin;
  const group=origins.get(origin) || {source:origin,inspected:0,needsLinking:0,recovered:0,repaired:0,alreadyRecorded:0,excluded:0};
  origins.set(origin,group);
  if(candidate.blockId!==blockId)continue;
  summary.answersInspected++;group.inspected++;
  if(excluded(candidate)){summary.excluded++;group.excluded++;continue;}
  const ids=canonicalObjectiveIds(candidate.objectiveIds,objectives);
  const key=questionEvidenceKey(candidate.questionKey);
  if(!ids.length || !key){
   summary.needsLinking++;group.needsLinking++;
   const reason=!key?'Missing question identity':!candidate.objectiveIds?.length?'No objective link': 'Objective reference outside active lecture catalog';
   unresolved.push({source:origin,origin:original.origin,sessionId:original.originSessionId || original.sessionKey,lectureId:candidate.lectureId || null,lectureLabel:candidate.lectureLabel || null,questionKey:candidate.questionKey || null,objectiveIds:candidate.objectiveIds || [],stem:candidate.stem || candidate.concept || '',at:candidate.at,reason,basis,hasFullQuestion:!!candidate.choices});
   continue;
  }
  const existing=journal.filter(event=>event.blockId===blockId && questionEvidenceKey(event.questionKey)===key);
  const match=existing.find(event=>event.eventId && event.eventId===candidate.eventId)
    || existing.find(event=>event.sessionKey===candidate.sessionKey)
    || existing.find(event=>Math.abs(Number(event.at)-Number(candidate.at))<2000);
  if(match){
   const added=ids.filter(id=>!(match.objectiveIds || []).includes(id));
   if(!added.length){summary.alreadyRecorded++;group.alreadyRecorded++;continue;}
   const eventId=match.eventId || `history:${blockId}:${key}:${match.at}`;
   updates.set(eventId,{...match,eventId,objectiveIds:[...new Set([...(match.objectiveIds || []),...ids])],historyReconciled:true});
   summary.repairedLinks++;group.repaired++;
  }else if(existing.length || evidence.objectives && ids.every(id=>evidence.objectives[id]?.questionKeys?.includes(key))){
   // An old log without stable session/time cannot safely establish another attempt.
   summary.alreadyRecorded++;group.alreadyRecorded++;
  }else{
   const eventId=candidate.eventId || `history:${blockId}:${key}:${candidate.at || 'legacy'}`;
   if(updates.has(eventId))continue;
   updates.set(eventId,{...compactEvent(candidate),eventId,questionKey:key,objectiveIds:ids,historyReconciled:true});
   summary.recoveredAnswers++;group.recovered++;
  }
 }
 summary.legacyReviewedWithoutAnswers=objectives.filter(o=>(o.reviewStatus || o.status) && (o.reviewStatus || o.status)!=='untested' && !(evidence.objectives?.[o.id]?.attempts || o.attempts || o.totalAttempts)).length;
 return {summary,events:[...updates.values()],origins:[...origins.values()],unresolved};
}
