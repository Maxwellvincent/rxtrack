import {evidenceIdentity,excludedEvidenceKeys,questionIdentityValues} from './questionScoringPolicy.js';
/** Restore only dated, explicitly lecture-linked saved answers. Never infer links. */
export function recoverQuizHistory(records,journal,{blockId,lectures=[],objectives=[],ratings={}}){
 const lectureIds=new Set(lectures.filter(l=>l.blockId===blockId).map(l=>l.id));
 const objectiveMap=new Map(objectives.map(o=>[o.id||o.code,o]));
 const excluded=excludedEvidenceKeys(ratings),objectiveExcluded=excludedEvidenceKeys(ratings,'objective');
 const isExcluded=(r,set)=>questionIdentityValues(r).some(v=>set.has(evidenceIdentity(v)));
 const bySession=new Map(),events=[];
 const indexEvent=e=>{if(e.blockId!==blockId)return;const list=bySession.get(e.sessionKey)||[];list.push({...e,canonicalKey:evidenceIdentity(e.questionKey)});bySession.set(e.sessionKey,list);};
 (journal||[]).forEach(indexEvent);
 for(const r of records||[]){
  if((r.blockId&&r.blockId!==blockId)||!lectureIds.has(r.lectureId)||!r.sessionKey||!r.questionKey||!Number.isFinite(r.ts)||typeof r.correct!=='boolean'||isExcluded(r,excluded))continue;
  const key=evidenceIdentity(r.questionKey);
  const matches=(bySession.get(r.sessionKey)||[]).filter(e=>e.blockId===blockId&&e.sessionKey===r.sessionKey&&e.lectureId===r.lectureId&&((r.eventId&&e.eventId===r.eventId)||(e.canonicalKey===key&&Math.abs(e.at-r.ts)<=1000)||(e.correct===r.correct&&Math.abs(e.at-r.ts)<=10)));
  if(matches.length)continue;
  const event={eventId:r.eventId||`quiz-history:${blockId}:${r.sessionKey}:${key}:${r.ts}`,source:'quiz',blockId,lectureId:r.lectureId,sessionKey:r.sessionKey,questionKey:key,correct:r.correct,at:r.ts,historyReconciled:true,
   objectiveIds:isExcluded(r,objectiveExcluded)?[]:(r.objectiveIds||[]).filter(id=>{const o=objectiveMap.get(id);return o&&(o.linkedLecId||o.lectureId)===r.lectureId&&(!o.blockId||o.blockId===blockId);})};
  for(const field of ['confidence','difficulty','responseMs','taskType','orderLevel','reasoningVerified','learningContext','atomKey','objectiveFacetId','sourceRelationshipIds','relationshipSourceVersion'])if(r[field]!==undefined)event[field]=r[field];
  indexEvent(event);events.push(event);
 }return events;
}
