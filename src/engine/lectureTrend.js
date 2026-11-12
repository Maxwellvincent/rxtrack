import {isIndependentAttempt} from './practiceAssistance.js';
import {excludedEvidenceKeys,evidenceIdentity} from './questionScoringPolicy.js';
/** Dated scored events only. Undated legacy totals cannot create historical points. */
export function lectureTrend(model={}, {blockId,lectureId,ratings={},timeZone=Intl.DateTimeFormat().resolvedOptions().timeZone}={}){
 const excluded=excludedEvidenceKeys(ratings),seen=new Set(),days=new Map();
 const format=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'});
 for(const e of [...(model.evidenceJournal || model.learningJournal || [])].sort((a,b)=>a.at-b.at)){
  if(!isIndependentAttempt(e))continue;
  if((!e.eventId&&!e.questionKey)||Number.isNaN(new Date(e.at).getTime())||e.lectureId!==lectureId||e.blockId!==blockId||typeof e.correct!=='boolean'||!Number.isFinite(e.at)||e.at<=0||excluded.has(evidenceIdentity(e.questionKey)))continue;
  const id=e.eventId || JSON.stringify([e.questionKey,e.sessionKey,e.at]);if(seen.has(id))continue;seen.add(id);
  const parts=Object.fromEntries(format.formatToParts(new Date(e.at)).map(p=>[p.type,p.value]));const day=`${parts.year}-${parts.month}-${parts.day}`;
  const row=days.get(day)||{day,answered:0,correct:0};row.answered++;row.correct+=Number(e.correct);days.set(day,row);
 }
 let total=0,correct=0;return [...days.values()].sort((a,b)=>a.day.localeCompare(b.day)).map(r=>{total+=r.answered;correct+=r.correct;return {...r,accuracy:100*r.correct/r.answered,runningAccuracy:100*correct/total,cumulative:total};});
}
