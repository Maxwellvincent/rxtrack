import {evidenceIdentity,excludedEvidenceKeys,questionIdentityValues} from '../../../engine/questionScoringPolicy.js';
/** Reconcile mirrored per-answer writes, without collapsing later retakes even
 * when a legacy quiz reused the same session key. No synthetic answer records. */
export function practiceAnswerHistory(calibration=[],evidence={},blockId,lectureIds=[],ratings={}){
 const excluded=excludedEvidenceKeys(ratings);const isExcluded=q=>questionIdentityValues(q).some(v=>excluded.has(evidenceIdentity(v)));
 const events=(evidence.evidenceJournal||[]).filter(e=>e.source==='quiz'&&e.blockId===blockId&&typeof e.correct==='boolean'&&Number.isFinite(e.at)&&!isExcluded(e));
 const answers=[];
 const seen=new Set();
 for(const event of events){
  const key=event.eventId||JSON.stringify([event.sessionKey,evidenceIdentity(event.questionKey),event.at]);
  if(seen.has(key))continue;seen.add(key);
  answers.push({...event,ts:event.at,concept:event.concept||event.atomKey||event.questionKey||'Lecture question'});
 }
 const matched=new Set(),bySession=new Map();
 const indexAnswer=(a,i)=>{const list=bySession.get(a.sessionKey)||[];list.push({a,i,key:evidenceIdentity(a.questionKey)});bySession.set(a.sessionKey,list);};
 answers.forEach(indexAnswer);
 for(const entry of calibration){
  if(isExcluded(entry))continue;
  const key=evidenceIdentity(entry.questionKey||entry.stem);
  const candidates=(bySession.get(entry.sessionKey)||[]).filter(({a,i,key:answerKey})=>!matched.has(i)&&a.sessionKey===entry.sessionKey&&Math.abs(a.ts-entry.ts)<=1000&&((entry.eventId&&a.eventId===entry.eventId)||(key&&answerKey===key)||(a.lectureId===entry.lectureId&&a.correct===entry.correct&&Math.abs(a.ts-entry.ts)<=10)));
  const match=candidates.length===1?candidates[0]:null;const mirrored=!!match;if(match)matched.add(match.i);
  if(!mirrored){answers.push(entry);indexAnswer(entry,answers.length-1);}
 }
 const historicalStudy={answered:0,correct:0};
 for(const id of new Set(lectureIds)){
  const row=evidence.evidenceBaseline?.lectures?.[id];
  const count=Math.max(0,Number(row?.attempts)||0);
  const cutoff=Number(evidence.evidenceBaseline?.updatedAt);
  const datedPrefix=Number.isFinite(cutoff)?answers.filter(a=>a.lectureId===id&&a.ts<=cutoff):[];
  const remaining=Math.max(0,count-datedPrefix.length);
  historicalStudy.answered+=remaining;
  historicalStudy.correct+=Math.min(remaining,Math.max(0,(Number(row?.correct)||0)-datedPrefix.filter(a=>a.correct===true).length));
 }
 return {studyAnswers:answers,historicalStudy};
}
