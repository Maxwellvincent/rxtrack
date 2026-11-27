import * as banks from '../../stores/questionBanks.js';
import {sameChoices} from './sameChoices.js';
import * as meta from '../../stores/questionBankMeta.js';
import {classifyObjectiveMapping,createCurriculumReviewer,MAPPING_VERSION} from '../../engine/semanticObjectiveMapping.js';
import {linkSourceLecture} from '../features/exam/questionBankLinks.js';
import {weekRescueMatch,rankLectureContent} from './lectureContentMatch.js';
import {curriculumMappingProvenance} from '../../engine/curriculumMappingContext.js';
import {formatLectureLabel} from '../../lectureTitle.js';
import {blockProgressProjection} from './blockProgress.js';
import {applyLearnedHeadings,learnedHeadingMap,similarPrecedents} from '../../engine/learnedLinks.js';
const active=new Map();
export const mappingFailureReason=error=>String(error?.message || error || 'Unknown mapping failure').replace(/\bsk-[A-Za-z0-9_-]+/g,'[redacted]').slice(0,2000);
export const questionKey=(q,i)=>String(q.id || q.questionId || `${i}:${q.stem}`);
const identity=questionKey;
/** Stable fingerprint of the lectures and linked objectives a verdict was judged against. */
export function catalogSignature(lectures=[],objectives=[]){
 const parts=[...lectures.map(l=>`L:${l.id}`),...objectives.map(o=>`O:${o.id}:${o.linkedLecId||''}`)].sort().join('|');
 let hash=2166136261;for(const char of parts)hash=Math.imul(hash^char.charCodeAt(0),16777619)>>>0;
 return `${lectures.length}.${objectives.length}.${hash.toString(36)}`;
}
export function resumeQuestionBankMapping(args,deps={}){
 const lock=`${args.userId}:${args.blockId}:${args.filename}`;
 if(active.has(lock))return active.get(lock);
 const job=run(args,deps).finally(()=>active.delete(lock));active.set(lock,job);return job;
}
// `onlyKeys` limits a run to those questions. `crossBlock` marks a pass
// against another block: it leaves the bank's recorded home-block scope alone.
async function run({userId,blockId,filename,lectures=[],objectives=[],recheck=false,scope=null,aiMapping=true,onlyKeys=null,crossBlock=false,onProgress=()=>{}},deps){
 // The bank stays filed under blockId; linking searches its home block
 // (bankMappingScope.js) and looks at its focus week(s) first.
 const mapBlock=scope?.homeBlockId||blockId;
 const focusIds=new Set(scope?.focusLectureIds||[]);
 const readBanks=deps.readBanks || banks.read,writeBanks=deps.writeBanks || banks.writeAwait;
 const readMeta=deps.readMeta || meta.read,writeMeta=deps.writeMeta || meta.writeAwait;
 const classify=deps.classify || classifyObjectiveMapping;
 let state={...(Object.values(readMeta(userId)||{}).find(m=>m.filename===filename&&m.blockId===blockId)?.mappingProgress || {}),status:'running',error:null,updatedAt:Date.now()};
 const completed=new Set(!recheck&&state.version===MAPPING_VERSION ? state.completedQuestionKeys||[] : []);
 state.version=MAPPING_VERSION;
 const save=async()=>{
  state={...state,completedQuestionKeys:[...completed],evaluated:completed.size,updatedAt:Date.now()};
  const current=readMeta(userId)||{};const entry=Object.entries(current).find(([,m])=>m.filename===filename&&m.blockId===blockId);
  if(!entry)throw Error('Question bank metadata is unavailable in this block. Mapping did not modify the bank.');
  await writeMeta(userId,{...current,[entry[0]]:{...entry[1],mappingProgress:state}});onProgress(state);
 };
 const eligible=q=>q.correct&&q.answerKeyVerified!==false&&!['user-confirmed','evidence-verified'].includes(q.curriculumLinkStatus);
 try{
  let source=readBanks(userId)?.[filename];if(!Array.isArray(source))throw Error('Saved question bank was not found.');
  // Learn from the learner's own links across every bank in this block.
  const blockFiles=new Set(Object.values(readMeta(userId)||{}).filter(m=>m?.blockId===blockId).map(m=>m.filename).concat(filename));
  const blockQuestions=()=>Object.entries(readBanks(userId)||{}).filter(([name])=>blockFiles.has(name)).flatMap(([,list])=>Array.isArray(list)?list:[]);
  const learned=applyLearnedHeadings(source,learnedHeadingMap(blockQuestions()));
  if(learned.applied){const all=readBanks(userId)||{};await writeBanks(userId,{...all,[filename]:learned.questions});source=learned.questions;state.learnedHeadingLinks=(state.learnedHeadingLinks||0)+learned.applied;}
  const precedentPool=blockQuestions().filter(item=>item?.curriculumLinkStatus==='user-confirmed');
  state.total=source.length;await save();
  if(scope&&!crossBlock)state.scope={homeBlockId:mapBlock,focusWeeks:scope.focusWeeks||[],format:scope.format||null,filedBlockId:blockId};
  const catalog=blockProgressProjection({blockId:mapBlock,lectures,catalog:objectives,evidence:{}}).linked;
  // An unresolved verdict is only final for the curriculum it was judged
  // against. When lectures or objectives change (for example objectives
  // imported after a run), earlier unresolved questions are evaluated again.
  const signature=catalogSignature(lectures.filter(l=>l.blockId===mapBlock),catalog)+(focusIds.size?`:f${[...focusIds].sort().join(',').length}`:'');
  if(state.catalogSignature!==signature)source.forEach((q,i)=>{if(eligible(q))completed.delete(identity(q,i));});
  state.catalogSignature=signature;
  const pending=aiMapping?source.map((q,i)=>({q,key:identity(q,i)})).filter(({q,key})=>eligible(q)&&!completed.has(key)&&(!onlyKeys||onlyKeys.has(key))):[];
  let enriched=null;
  const loadLectures=async()=>{
   if(enriched)return enriched;
   const fetch=deps.fetchLectureContent || (await import('../../firebaseData.js')).fetchLectureContent;
   enriched=[];
   for(const l of lectures.filter(l=>l.blockId===mapBlock)){
    const content=l.chunks?.length?null:await fetch(userId,l.id);enriched.push({...content,...l,chunks:content?.chunks||l.chunks,atoms:l.atoms||content?.atoms,id:l.id,blockId:mapBlock});
   }
   return enriched;
  };
  if(pending.length){
   const available=deps.bridgeAvailable || (await import('../../llmBridge.js')).bridgeAvailable;
   if(!await available())throw Error('Local AI bridge unavailable. Start the bridge, then resume mapping.');
   await loadLectures();
   const focusLectures=enriched.filter(l=>focusIds.has(l.id));
   const review=deps.review || createCurriculumReviewer();
   for(const {q,key} of pending){
    state.currentQuestion=key;await save();
    let evaluation;
    // A lecture the learner assigned is authoritative: mapping may only add
    // objective credit within it, never move the question elsewhere.
    const pinned=['user-assigned','learned-heading'].includes(q.lectureLinkBasis)&&q.lectureId?q:null;
    const attributed=pinned||linkSourceLecture({...q,sourceTitle:filename},enriched,mapBlock);
    const focusLectureIds=focusLectures.length?rankLectureContent(q,focusLectures,mapBlock).slice(0,3).map(r=>r.lecture.id):[];
    let patch=await classify(attributed,{lectures:enriched,objectives:catalog,blockId:mapBlock,review,focusLectureIds,precedents:similarPrecedents(q,precedentPool),onEvaluation:async value=>{evaluation=value;}});
    if(pinned&&patch){
     if(patch.lectureId!==pinned.lectureId){evaluation={...(evaluation||{}),decision:'unresolved',reason:`Automatic mapping proposed ${patch.lectureLabel||patch.lectureId}, not your assigned lecture; your assignment was kept. Choose an objective manually if it fits.`};patch=null;}
     else patch={...patch,lectureId:pinned.lectureId,lectureLabel:pinned.lectureLabel,lectureLinkBasis:pinned.lectureLinkBasis};
    }
    state.lastSearch=patch?.curriculumMapping?.retrieval||evaluation?.retrieval||state.lastSearch;
    const current=readBanks(userId),list=current[filename];if(!Array.isArray(list))throw Error('Saved bank changed during mapping. Resume after it finishes saving.');
    const next=list.map((item,i)=>identity(item,i)===key&&sameChoices(item.choices,q.choices)&&item.correct===q.correct&&item.stem===q.stem&&eligible(item)?{...item,...(attributed.lectureId?{lectureId:attributed.lectureId,lectureLabel:attributed.lectureLabel,lectureLinkBasis:attributed.lectureLinkBasis,curriculumLinkStatus:attributed.curriculumLinkStatus,curriculumMapping:attributed.curriculumMapping}:{}),...(evaluation?{curriculumMappingReview:evaluation}:{}),...(patch||{})}:item);
    await writeBanks(userId,{...current,[filename]:next});completed.add(key);await save();
   }
  }
  // Week rescue (no AI): a question still without a lecture is matched
  // against the bank's focus week only, where the candidate set is small
  // enough for a distinctive lexical match. Lecture link only, no objective
  // credit.
  if(focusIds.size){
   const lecturesForRescue=(await loadLectures()).filter(l=>focusIds.has(l.id));
   const current=readBanks(userId),list=current?.[filename];
   if(Array.isArray(list)&&lecturesForRescue.length){
    let rescued=0;
    const next=list.map(item=>{
     if(item.lectureId||!item.stem||!eligible(item))return item;
     const match=weekRescueMatch(item,lecturesForRescue,mapBlock);
     if(!match)return item;
     rescued++;
     return {...item,lectureId:match.lecture.id,lectureLabel:formatLectureLabel(match.lecture),curriculumLinkStatus:'content-matched',lectureLinkBasis:'bank-week-content',lectureLinkEvidence:match.titleEvidence,curriculumMapping:curriculumMappingProvenance(item,match.lecture,mapBlock,'bank-week-content')};
    });
    if(rescued){await writeBanks(userId,{...current,[filename]:next});state.weekRescued=rescued;}
   }
  }
  state.status='complete';state.currentQuestion=null;
 }catch(error){state.status='paused';state.error=mappingFailureReason(error);state.lastFailure={reason:state.error,at:Date.now(),questionKey:state.currentQuestion || null};}
 const reviews=(readBanks(userId)?.[filename]||[]).filter(q=>!['user-confirmed','evidence-verified'].includes(q.curriculumLinkStatus)).map(q=>q.curriculumMappingReview).filter(Boolean);
 state.unresolvedReasons=[...new Set(reviews.map(r=>r.reason).filter(Boolean))].slice(0,3);
 state.lectureLinked=(readBanks(userId)?.[filename]||[]).filter(q=>q.lectureId&&q.lectureLinkBasis).length;
 state.linked=(readBanks(userId)?.[filename]||[]).filter(q=>['user-confirmed','evidence-verified'].includes(q.curriculumLinkStatus)).length;
 await save();return state;
}
