import { usableSchoolExemplar, requiresSchoolFigure, schoolExemplarIssues } from "./schoolSourceIntegrity.js";
import { buildStyleFingerprint, exemplarSourceTier } from './mcq.js';

export const BASELINE_VERSION = 4;
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
/** Counts explain availability, not whether a model actually used an example. */
export function schoolSourceInventory(banks={}) {
 const bySource=new Map();
 for(const [filename,items] of Object.entries(banks || {})) for(const item of Array.isArray(items)?items:[]) {
  const q={...item,sourceFile:item?.sourceFile || filename};
  const kind=exemplarSourceTier(q);
  const key=JSON.stringify([q.sourceFile,kind]);
  if(!bySource.has(key))bySource.set(key,{sourceFile:q.sourceFile,sourceKind:kind,total:0,textTemplateEligible:0,figureDependent:0,constructionOnly:0,exclusionReasons:{}});
  const row=bySource.get(key);row.total++;
  const reasons=[...schoolExemplarIssues(q)];
  if(q.sourceKeyReviewStatus && !reasons.includes('unverified_source_key'))reasons.push('source_key_review_pending');
  if(!q.correct && kind!=='clicker')reasons.push('missing_answer_key');
  if(q.correct && !q.choices?.[q.correct])reasons.push('key_not_in_choices');
  if(requiresSchoolFigure(q)){row.figureDependent++;reasons.push('requires_source_figure');}
  if(!reasons.length){row.textTemplateEligible++;if(!q.correct)row.constructionOnly++;}
  for(const reason of new Set(reasons))row.exclusionReasons[reason]=(row.exclusionReasons[reason] || 0)+1;
 }
 return [...bySource.values()].sort((a,b)=>a.sourceKind.localeCompare(b.sourceKind) || a.sourceFile.localeCompare(b.sourceFile));
}
function reviewItem(q,role,objectives=[]) {
 const objectiveLinks=(q.objectiveIds || []).map(id=>{
  let candidates=objectives.filter(o=>String(o.id || o.code)===String(id));
  const block=q.sourceBlockId || q.blockId;
  if(block)candidates=candidates.filter(o=>o.blockId===block);
  if(q.lectureId && candidates.some(o=>(o.linkedLecId || o.lectureId)===q.lectureId))candidates=candidates.filter(o=>(o.linkedLecId || o.lectureId)===q.lectureId);
  const unique=[...new Map(candidates.map(o=>{
   const value={id:String(o.id || o.code),code:o.code || null,text:String(o.objective || o.text || '').trim(),blockId:o.blockId || null,lectureId:o.linkedLecId || o.lectureId || null};
   return [JSON.stringify(value),value];
  })).values()].filter(o=>o.text);
  return {objectiveId:id,status:unique.length===1?'resolved':unique.length?'ambiguous':'unresolved',lectureAlignment:!q.lectureId || !unique.length ? 'unknown' : unique.every(o=>!o.lectureId) ? 'unassigned' : unique.every(o=>o.lectureId===q.lectureId) ? 'matched' : 'mismatch',candidates:unique};
 });
 const assigned=objectiveLinks.length===1 && objectiveLinks[0].status==='resolved' ? objectiveLinks[0].candidates[0] : null;
 // Explicit allowlist: no account IDs, signed URLs, tokens, prompts, or answer history.
 return {
  auditId:`${role}:${rank(stableKey(q)).toString(36)}`, role,
  exposureToGeneration:role === 'generated' ? 'already-generated' : 'unknown',
  referenceUse:role === 'clicker' && !q.correct ? 'construction-only' : 'construction-and-key-review',
  answerKeyAvailable:!!q.correct,
  originalId:q.id || q.questionId || null, lectureId:q.lectureId || null,
  sourceFile:q.sourceFile || null, sourceSection:q.sourceSection || null,
  sourcePage:q.sourcePage || null, sourceQuestionNumber:q.sourceQuestionNumber || q.num || null,
  objectiveIds:q.objectiveIds || [], objectiveText:assigned?.text || q.objectiveText || null,
  objectiveLinks,
  objectiveFacet:q.objectiveFacet || null, topic:q.topic || null,
  stem:q.stem, choices:q.choices, correct:q.correct || null,
  explanation:q.explanation || null, whyWrong:q.whyWrong || {},
  figureRequired:requiresSchoolFigure(q),
  figureIncluded:false, generationVersion:q.generationVersion || null,
  reviewedAt:q.qualityAudit?.reviewedAt || null,
  qualityReviewPolicy:q.qualityAudit?.reviewPolicy || null,
  reviewedDiscrimination:q.qualityAudit?.discrimination ? {closestAlternative:q.qualityAudit.discrimination.closestAlternative || null,stemClue:q.qualityAudit.discrimination.stemClue || null,whyAlternativeFails:q.qualityAudit.discrimination.whyAlternativeFails || null,keyUniquelySupported:q.qualityAudit.discrimination.keyUniquelySupported===true,alternativeAlsoCorrect:q.qualityAudit.discrimination.alternativeAlsoCorrect===true} : null,
  reviewedObjectiveId:q.qualityAudit?.objectiveId || null,
  reviewedObjectiveClause:q.qualityAudit?.objectiveAlignment?.objectiveClause || null,
  suppliedTemplateReferences:(q.generationEvidence?.templateReferences || []).map(ref=>({templateId:ref.templateId || null,objectiveId:ref.objectiveId || null,sourceKind:ref.sourceKind || null,sourceFile:ref.sourceFile || null,sourceQuestionId:ref.sourceQuestionId || null})),
  claimedOrder:q.orderLevel || null,
  reasoningAudit:q.reasoningAudit ? {status:q.reasoningAudit.status,version:q.reasoningAudit.version,reviewPolicy:q.reasoningAudit.reviewPolicy || null,sourceBasis:q.reasoningAudit.sourceBasis || null,orderLevel:q.reasoningAudit.orderLevel,steps:q.reasoningAudit.steps || [],sourceQuotes:q.reasoningAudit.sourceQuotes || []} : null,
  review:{verdict:null,actualReasoning:null,patientCluesSufficient:null,sourceSupported:null,singleBestAnswer:null,schoolWordingFit:null,closestDistractorPlausible:null,figureChecked:null,issueCodes:[],notes:''},
 };
}
/** Local review packet only. This neither trains a model nor certifies an item. */
export function buildQuestionAuditBaseline({generated={},banks={},objectives=[],generatedLimit=48,sourceLimit=12,now=Date.now()}={}) {
 const usable=q=>q?.stem && q?.choices && Object.keys(q.choices).length>=2;
 const unique=rows=>[...new Map(rows.map(q=>[stableKey(q),q])).values()];
 const generatedRows=unique(Object.entries(generated).flatMap(([lectureId,entry])=>(entry?.questions || []).filter(usable).map(q=>({...q,lectureId:q.lectureId || lectureId}))));
 const originals=unique(Object.entries(banks).flatMap(([filename,qs])=>(Array.isArray(qs)?qs:[]).filter(usable).map(q=>({...q,sourceFile:q.sourceFile || filename}))));
 const limits={generated:Math.min(100,Math.max(0,Math.floor(Number(generatedLimit)||0))),source:Math.min(30,Math.max(0,Math.floor(Number(sourceLimit)||0)))};
 const eligible=originals.filter(usableSchoolExemplar).filter(q=>(q.correct || exemplarSourceTier(q)==='clicker') && q.answerKeyVerified!==false && !q.sourceKeyReviewStatus && q.sourceRepresentation!=='answer-explanation-summary');
 const roles=['homework','examsoft','imcq','clicker'];
 const samples=[...balancedSample(generatedRows,limits.generated).map(q=>reviewItem(q,'generated',objectives)),
  ...roles.flatMap(role=>balancedSample(eligible.filter(q=>exemplarSourceTier(q)===role),limits.source).map(q=>reviewItem(q,role,objectives)))];
 return {version:BASELINE_VERSION,createdAt:new Date(now).toISOString(),
  purpose:'Manual quality baseline; no medical validation, training or held-out assessment implied.',
  limitations:['Figures are referenced by source page, not embedded; review them in the original source.','Existing originals may already have been supplied to generation. These are reference samples, not an unseen holdout.','Unkeyed in-class examples are construction-only references; no answer key is inferred.','Sampling covers the currently loaded retained stores, not a complete lifetime archive.','Automated wording statistics do not measure reasoning depth or exam equivalence.','Objective text is resolved by stored ID and explicit scope only; unresolved or ambiguous links are not inferred from topic similarity.'],
  sourceInventory:schoolSourceInventory(banks),
  provenanceCoverage:{generatedSample:samples.filter(q=>q.role==='generated').length,withTemplateReferences:samples.filter(q=>q.role==='generated' && q.suppliedTemplateReferences.length).length,withReviewPolicy:samples.filter(q=>q.role==='generated' && q.qualityReviewPolicy).length},
  population:{generated:generatedRows.length,originals:originals.length,eligibleOriginals:eligible.length,excludedOriginals:originals.length-eligible.length},
  sampled:Object.fromEntries(['generated',...roles].map(role=>[role,samples.filter(q=>q.role===role).length])),
  descriptiveProfiles:Object.fromEntries(['generated',...roles].map(role=>[role,buildStyleFingerprint(samples.filter(q=>q.role===role))])),samples};
}
export function downloadQuestionAuditBaseline(packet) {
 const url=URL.createObjectURL(new Blob([JSON.stringify(packet,null,2)],{type:'application/json'}));
 const link=document.createElement('a');link.href=url;link.download=`rxtrack-question-baseline-${packet.createdAt.slice(0,10)}.json`;link.click();
 setTimeout(()=>URL.revokeObjectURL(url),1000);
}
