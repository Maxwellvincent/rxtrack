import * as banks from '../../stores/questionBanks.js';
import * as meta from '../../stores/questionBankMeta.js';
import {classifyObjectiveMapping,createCurriculumReviewer} from '../../engine/semanticObjectiveMapping.js';
import {blockProgressProjection} from './blockProgress.js';
const active=new Map();
export const mappingFailureReason=error=>String(error?.message || error || 'Unknown mapping failure').replace(/\bsk-[A-Za-z0-9_-]+/g,'[redacted]').slice(0,2000);
const identity=(q,i)=>String(q.id || q.questionId || `${i}:${q.stem}`);
export function resumeQuestionBankMapping(args,deps={}){
 const lock=`${args.userId}:${args.blockId}:${args.filename}`;
 if(active.has(lock))return active.get(lock);
 const job=run(args,deps).finally(()=>active.delete(lock));active.set(lock,job);return job;
}
async function run({userId,blockId,filename,lectures=[],objectives=[],onProgress=()=>{}},deps){
 const readBanks=deps.readBanks || banks.read,writeBanks=deps.writeBanks || banks.writeAwait;
 const readMeta=deps.readMeta || meta.read,writeMeta=deps.writeMeta || meta.writeAwait;
 const classify=deps.classify || classifyObjectiveMapping;
 let state={...(Object.values(readMeta(userId)||{}).find(m=>m.filename===filename&&m.blockId===blockId)?.mappingProgress || {}),status:'running',error:null,updatedAt:Date.now()};
 const completed=new Set(state.completedQuestionKeys||[]);
 const save=async()=>{
  state={...state,completedQuestionKeys:[...completed],evaluated:completed.size,updatedAt:Date.now()};
  const current=readMeta(userId)||{};const entry=Object.entries(current).find(([,m])=>m.filename===filename&&m.blockId===blockId);
  if(!entry)throw Error('Question bank metadata is unavailable in this block. Mapping did not modify the bank.');
  await writeMeta(userId,{...current,[entry[0]]:{...entry[1],mappingProgress:state}});onProgress(state);
 };
 const eligible=q=>q.correct&&q.answerKeyVerified!==false&&!['user-confirmed','evidence-verified'].includes(q.curriculumLinkStatus);
 try{
  const source=readBanks(userId)?.[filename];if(!Array.isArray(source))throw Error('Saved question bank was not found.');
  state.total=source.length;await save();
  const pending=source.map((q,i)=>({q,key:identity(q,i)})).filter(({q,key})=>eligible(q)&&!completed.has(key));
  if(pending.length){
   const available=deps.bridgeAvailable || (await import('../../llmBridge.js')).bridgeAvailable;
   if(!await available())throw Error('Local AI bridge unavailable. Start the bridge, then resume mapping.');
   const fetch=deps.fetchLectureContent || (await import('../../supabase.js')).fetchLectureContent;
   const enriched=[];
   for(const l of lectures.filter(l=>l.blockId===blockId)){
    const content=await fetch(userId,l.id);enriched.push({...content,...l,chunks:content?.chunks||l.chunks,id:l.id,blockId});
   }
   const catalog=blockProgressProjection({blockId,lectures,catalog:objectives,evidence:{}}).linked;
   const review=deps.review || createCurriculumReviewer();
   for(const {q,key} of pending){
    state.currentQuestion=key;await save();
    let evaluation;
    const patch=await classify({...q,sourceTitle:filename},{lectures:enriched,objectives:catalog,blockId,review,onEvaluation:async value=>{evaluation=value;}});
    const current=readBanks(userId),list=current[filename];if(!Array.isArray(list))throw Error('Saved bank changed during mapping. Resume after it finishes saving.');
    const next=list.map((item,i)=>identity(item,i)===key&&JSON.stringify(item.choices)===JSON.stringify(q.choices)&&item.correct===q.correct&&item.stem===q.stem&&eligible(item)?{...item,...(evaluation?{curriculumMappingReview:evaluation}:{}),...(patch||{})}:item);
    await writeBanks(userId,{...current,[filename]:next});completed.add(key);await save();
   }
  }
  state.status='complete';state.currentQuestion=null;
 }catch(error){state.status='paused';state.error=mappingFailureReason(error);}
 state.linked=(readBanks(userId)?.[filename]||[]).filter(q=>['user-confirmed','evidence-verified'].includes(q.curriculumLinkStatus)).length;
 await save();return state;
}
