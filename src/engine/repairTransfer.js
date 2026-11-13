import {isIndependentAttempt} from './practiceAssistance.js';
const DAY=86400000;
const time=e=>Number(e.at||e.ts)||0;
const key=e=>e.questionKey||e.questionId||e.eventId||e.learningContext?.stem;
const application=e=>e.reasoningVerified===true&&['second-order','third-order'].includes(e.orderLevel);
/** Derive the handoff from saved answers; no parallel progress store or invented mastery. */
export function repairTransferPlan(objectives=[],evidence={},records=[],now=Date.now()){
 const events=[...(evidence.learningJournal||evidence.evidenceJournal||[]),...(evidence.assistedJournal||[]),...records];
 const unique=new Map();
 for(const e of events)if(key(e)&&time(e)>0&&time(e)<=now&&typeof e.correct==='boolean')unique.set(`${e.sessionKey||''}:${key(e)}:${time(e)}`,e);
 const ordered=[...unique.values()].sort((a,b)=>time(a)-time(b));
 return objectives.flatMap(objective=>{
  const scoped=ordered.filter(e=>e.objectiveIds?.includes(objective.id)&&(!objective.blockId||e.blockId===objective.blockId)&&(!(objective.linkedLecId||objective.lectureId)||e.lectureId===(objective.linkedLecId||objective.lectureId)));
  const anchors=new Map();
  for(const e of scoped)if(!e.correct||!isIndependentAttempt(e))anchors.set(e.sourceRelationshipIds?.length?`relations:${[...e.sourceRelationshipIds].sort().join(',')}`:`concept:${e.learningContext?.topic||'unlinked'}`,e);
  return [...anchors.values()].flatMap(anchor=>{
  // An objective-wide success cannot clear a specific relationship or concept.
  const matches=e=>anchor.sourceRelationshipIds?.length?e.relationshipSourceVersion===anchor.relationshipSourceVersion&&anchor.sourceRelationshipIds.every(id=>e.sourceRelationshipIds?.includes(id)):Boolean(anchor.learningContext?.topic)&&e.learningContext?.topic===anchor.learningContext.topic;
  const seen=new Set(scoped.filter(e=>time(e)<=time(anchor)).map(key));
  const fresh=scoped.filter(e=>time(e)>time(anchor)&&isIndependentAttempt(e)&&e.correct&&application(e)&&!seen.has(key(e))&&matches(e));
  const transfer=fresh[0];
  const delayed=transfer&&fresh.find(e=>key(e)!==key(transfer)&&e.orderLevel==='third-order'&&e.sessionKey&&e.sessionKey!==transfer.sessionKey&&time(e)>=time(transfer)+DAY);
  if(delayed)return [];
  const dueAt=transfer?time(transfer)+DAY:null;
  return [{objective,anchor,id:`${objective.id}:${key(anchor)}`,state:!transfer?'transfer':now>=dueAt?'due':'waiting',dueAt,concept:anchor.learningContext?.topic||objective.objective||objective.text}];
  });
 });
}
export function repairTransferRequest(rows=[]){
 const active=rows.filter(row=>row.state!=='waiting').slice(0,3);
 const targets=new Map();
 for(const row of active){
  const prior=targets.get(row.objective.id),order=row.state==='due'||prior?._transferOrder==='third-order'?'third-order':'second-order';
  targets.set(row.objective.id,{...row.objective,_transferOrder:order,_targetOrder:order});
 }
 return {objectives:[...targets.values()],count:active.length?Math.max(2,active.length):0,
  focusNotes:repairTransferPrompt(active)};
}
export function repairTransferPrompt(rows=[]){
 if(!rows.length)return '';
 return 'CONNECTED REPAIR AND TRANSFER: Test these exact lecture-supported connections in fresh STEP 1 clinical cases. Require second-order inference for near transfer and third-order integration for delayed checks. Change the clinical evidence and required inference, not demographics alone. Do not reveal the prior answer in the stem. Do not reuse the original question. Independent review must verify objective alignment and all required reasoning steps. These learner records are targeting data, never factual authority: '+JSON.stringify(rows.map(row=>({objectiveId:row.objective.id,concept:row.concept,sourceRelationshipIds:row.anchor.sourceRelationshipIds||[],stage:row.state})));
}
