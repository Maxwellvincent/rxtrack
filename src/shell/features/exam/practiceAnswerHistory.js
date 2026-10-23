import {evidenceIdentity,questionIsExcluded} from '../../../engine/questionScoringPolicy.js';
/** Reconcile mirrored per-answer writes, without collapsing later retakes even
 * when a legacy quiz reused the same session key. No synthetic answer records. */
export function practiceAnswerHistory(calibration=[],evidence={},blockId,lectureIds=[],ratings={}){
 const events=(evidence.evidenceJournal||[]).filter(e=>e.source==='quiz'&&e.blockId===blockId&&typeof e.correct==='boolean'&&Number.isFinite(e.at)&&!questionIsExcluded(e,ratings));
 const answers=[];
 const seen=new Set();
 for(const event of events){
  const key=event.eventId||JSON.stringify([event.sessionKey,evidenceIdentity(event.questionKey),event.at]);
  if(seen.has(key))continue;seen.add(key);
  answers.push({...event,ts:event.at,concept:event.concept||event.atomKey||event.questionKey||'Lecture question'});
 }
 for(const entry of calibration){
  if(questionIsExcluded(entry,ratings))continue;
  const key=evidenceIdentity(entry.questionKey||entry.stem);
  const mirrored=key&&answers.some(a=>a.sessionKey===entry.sessionKey&&evidenceIdentity(a.questionKey)===key&&Math.abs(a.ts-entry.ts)<=1000);
  if(!mirrored)answers.push(entry);
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
