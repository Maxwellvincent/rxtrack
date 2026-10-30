import { usableSchoolExemplar } from "./schoolSourceIntegrity.js";
import { buildStyleFingerprint, exemplarSourceTier } from './mcq.js';

export const BASELINE_VERSION = 1;
const stableKey = q => JSON.stringify([q.sourceFile || '', q.lectureId || '', q.id || q.questionId || '', q.stem || '']);
// Reproducible spread, not newest-only or highest-scoring selection.
function rank(value) {
 let hash=2166136261;
 for(const char of value){hash^=char.charCodeAt(0);hash=Math.imul(hash,16777619);}
 return hash>>>0;
}
function balancedSample(rows,limit) {
 const groups=new Map();
 for(const row of [...rows].sort((a,b)=>rank(stableKey(a))-rank(stableKey(b)) || stableKey(a).localeCompare(stableKey(b)))){
  const group=row.lectureId || row.sourceSection || row.sourceFile || 'unknown';
  if(!groups.has(group))groups.set(group,[]);
  groups.get(group).push(row);
 }
 const selected=[];
 while(selected.length<limit){let added=false;
  for(const group of groups.values()){
   if(selected.length>=limit)break;
   if(group.length){selected.push(group.shift());added=true;}
  }if(!added)break;
 }
 return selected;
}
function reviewItem(q,role) {
 // Explicit allowlist: no account IDs, signed URLs, tokens, prompts, or answer history.
 return {
  auditId:`${role}:${rank(stableKey(q)).toString(36)}`, role,
  originalId:q.id || q.questionId || null, lectureId:q.lectureId || null,
  sourceFile:q.sourceFile || null, sourceSection:q.sourceSection || null,
  sourcePage:q.sourcePage || null, sourceQuestionNumber:q.sourceQuestionNumber || q.num || null,
  objectiveIds:q.objectiveIds || [], objectiveText:q.objectiveText || null,
  objectiveFacet:q.objectiveFacet || null, topic:q.topic || null,
  stem:q.stem, choices:q.choices, correct:q.correct || null,
  explanation:q.explanation || null, whyWrong:q.whyWrong || {},
  figureRequired:!!(q.hasImage || q.imageQuestion || q.imageDependent),
  figureIncluded:false, generationVersion:q.generationVersion || null,
  reviewedAt:q.qualityAudit?.reviewedAt || null,
  claimedOrder:q.orderLevel || null,
  reasoningAudit:q.reasoningAudit ? {status:q.reasoningAudit.status,version:q.reasoningAudit.version,reviewPolicy:q.reasoningAudit.reviewPolicy || null,sourceBasis:q.reasoningAudit.sourceBasis || null,orderLevel:q.reasoningAudit.orderLevel,steps:q.reasoningAudit.steps || [],sourceQuotes:q.reasoningAudit.sourceQuotes || []} : null,
  review:{verdict:null,actualReasoning:null,patientCluesSufficient:null,sourceSupported:null,singleBestAnswer:null,schoolWordingFit:null,closestDistractorPlausible:null,issueCodes:[],notes:''},
 };
}
/** Local review packet only. This neither trains a model nor certifies an item. */
export function buildQuestionAuditBaseline({generated={},banks={},generatedLimit=48,sourceLimit=12,now=Date.now()}={}) {
 const usable=q=>q?.stem && q?.choices && Object.keys(q.choices).length>=2;
 const unique=rows=>[...new Map(rows.map(q=>[stableKey(q),q])).values()];
 const generatedRows=unique(Object.entries(generated).flatMap(([lectureId,entry])=>(entry?.questions || []).filter(usable).map(q=>({...q,lectureId:q.lectureId || lectureId}))));
 const originals=unique(Object.entries(banks).flatMap(([filename,qs])=>(Array.isArray(qs)?qs:[]).filter(usable).map(q=>({...q,sourceFile:q.sourceFile || filename}))));
 const limits={generated:Math.min(100,Math.max(0,Math.floor(Number(generatedLimit)||0))),source:Math.min(30,Math.max(0,Math.floor(Number(sourceLimit)||0)))};
 const eligible=originals.filter(usableSchoolExemplar).filter(q=>q.correct && q.answerKeyVerified!==false && !q.sourceKeyReviewStatus && q.sourceRepresentation!=='answer-explanation-summary');
 const roles=['homework','examsoft','imcq'];
 const samples=[...balancedSample(generatedRows,limits.generated).map(q=>reviewItem(q,'generated')),
  ...roles.flatMap(role=>balancedSample(eligible.filter(q=>exemplarSourceTier(q)===role),limits.source).map(q=>reviewItem(q,role)))];
 return {version:BASELINE_VERSION,createdAt:new Date(now).toISOString(),
  purpose:'Manual quality baseline; no medical validation, training or held-out assessment implied.',
  limitations:['Figures are referenced by source page, not embedded; review them in the original source.','Existing originals may already have been supplied to generation. These are reference samples, not an unseen holdout.','Sampling covers the currently loaded retained stores, not a complete lifetime archive.','Automated wording statistics do not measure reasoning depth or exam equivalence.'],
  population:{generated:generatedRows.length,originals:originals.length,eligibleOriginals:eligible.length,excludedOriginals:originals.length-eligible.length},
  sampled:Object.fromEntries(['generated',...roles].map(role=>[role,samples.filter(q=>q.role===role).length])),
  descriptiveProfiles:Object.fromEntries(['generated',...roles].map(role=>[role,buildStyleFingerprint(samples.filter(q=>q.role===role))])),samples};
}
export function downloadQuestionAuditBaseline(packet) {
 const url=URL.createObjectURL(new Blob([JSON.stringify(packet,null,2)],{type:'application/json'}));
 const link=document.createElement('a');link.href=url;link.download=`rxtrack-question-baseline-${packet.createdAt.slice(0,10)}.json`;link.click();
 setTimeout(()=>URL.revokeObjectURL(url),1000);
}
