import {isIndependentAttempt} from './practiceAssistance.js';
import {relationshipPractice} from './relationshipPractice.js';
import {stableRecordId} from './sourceUse.js';
import {hasReusableQuestionReview} from './questionReuse.js';
const norm=value=>String(value || '').normalize('NFKC').toLowerCase().replace(/\s+/g,' ').trim();
export const RELATIONSHIP_VERSION=1;
export const emptyRelationships=()=>({version:RELATIONSHIP_VERSION,facets:{},relationships:{}});
export function relationshipSourceVersion(pages=[]) {return stableRecordId(pages.map(page=>[page.page,norm(page.text)]),'lecture');}
export function relationshipPages(lecture={},text='') {
 const chunks=lecture.chunks || [];
 return chunks.length?chunks.map((chunk,index)=>({page:Number(chunk.pageNumber || chunk.page || index+1),text:chunk.markdown || chunk.text || chunk.content || ''}))
  :String(text || lecture.extractedText || lecture.fullText || lecture.content || '').split(/\f/).map((body,index)=>({page:index+1,text:body}));
}
/** IDs are scoped to their parent and exact clause/source relationship, never a topic guess. */
export function createSourceRelationship({blockId,lectureId,objective,clause,label,quote,page,kind='text',pages=[]}) {
 if(!blockId || !lectureId || !objective?.id || objective.blockId && objective.blockId!==blockId || (objective.linkedLecId || objective.lectureId) && (objective.linkedLecId || objective.lectureId)!==lectureId)throw new Error('A relationship needs a valid parent objective and lecture.');
 const objectiveText=norm(objective.objective || objective.text);
 if(norm(clause).length<8 || !objectiveText.includes(norm(clause)))throw new Error('The clause must occur in the assigned objective.');
 const source=pages.find(source=>source.page===Number(page));
 if(norm(quote).length<16 || !source || !norm(source.text).includes(norm(quote)) || norm(quote)===objectiveText)throw new Error('The quotation must occur on the selected original source page.');
 if(!['text','table','figure'].includes(kind))throw new Error('Choose text, table or figure evidence.');
 const scope={blockId,lectureId,objectiveId:String(objective.id)};
 const facetId=stableRecordId([scope,norm(clause)],'facet');
 const relationshipId=stableRecordId([facetId,norm(quote),kind],'relationship');
 const sourceVersion=relationshipSourceVersion(pages);
 return {facet:{id:facetId,...scope,clause:String(clause).trim(),label:String(label || clause).trim().slice(0,160),status:'source-located',inventoryComplete:false},
  relationship:{id:relationshipId,facetId,...scope,label:String(label || clause).trim().slice(0,160),quote:String(quote).trim(),page:Number(page),kind,sourceVersion,status:'source-located',visualReviewRequired:kind==='figure'}};
}
export function mergeSourceRelationships(catalog,bundles=[]) {
 const next={...emptyRelationships(),...catalog,facets:{...catalog?.facets},relationships:{...catalog?.relationships}};
 for(const {facet,relationship} of bundles){
  const old=next.relationships[relationship.id];
  next.facets[facet.id]={...next.facets[facet.id],...facet};
  next.relationships[relationship.id]={...relationship,revision:(old?.revision || 0)+(old?.sourceVersion===relationship.sourceVersion?0:1)};
 }
 if(new TextEncoder().encode(JSON.stringify(next)).length>850000)throw new Error('This lecture relationship catalog is full; no records were evicted.');
 return next;
}
export function validSourceRelationships(catalog,{blockId,lectureId,objectives=[],pages=[]}) {
 const byId=new Map(objectives.map(objective=>[String(objective.id),objective]));
 const version=relationshipSourceVersion(pages);
 return Object.values(catalog?.relationships || {}).filter(row=>{
  const facet=catalog.facets?.[row.facetId],objective=byId.get(row.objectiveId),source=pages.find(source=>source.page===row.page);
  return row.blockId===blockId && row.lectureId===lectureId && row.sourceVersion===version && facet?.objectiveId===row.objectiveId && facet.blockId===blockId && facet.lectureId===lectureId
    && objective && (!objective.blockId || objective.blockId===blockId) && (!(objective.linkedLecId || objective.lectureId) || (objective.linkedLecId || objective.lectureId)===lectureId) && norm(facet.clause).length>=8 && norm(row.quote).length>=16 && norm(objective.objective || objective.text).includes(norm(facet.clause)) && source && norm(source.text).includes(norm(row.quote));
 });
}
export function relationshipCoverage(catalog,evidence={},scope={},now=Date.now()) {
 const journal=[...(evidence.learningJournal || evidence.evidenceJournal || []),...(evidence.assistedJournal||[])];
 return validSourceRelationships(catalog,scope).map(row=>{
  const latest=new Map(),events=[];
  for(const event of [...journal].sort((a,b)=>(a.at||0)-(b.at||0))){
   if(event.blockId!==row.blockId || event.lectureId!==row.lectureId || !event.objectiveIds?.includes(row.objectiveId)
    || event.relationshipSourceVersion!==row.sourceVersion || !event.sourceRelationshipIds?.includes(row.id) || typeof event.correct!=='boolean' || !event.questionKey)continue;
   events.push(event);if(isIndependentAttempt(event))latest.set(event.questionKey,event);
  }
  const answers=[...latest.values()].sort((a,b)=>(a.at||0)-(b.at||0));
  return {...row,...relationshipPractice(events,now),attempts:answers.length,correct:answers.filter(answer=>answer.correct).length,lastCorrect:answers.at(-1)?.correct ?? null,lastAt:answers.at(-1)?.at || null};
 });
}
export function relationshipTargets(catalog,evidence,scope,count=3,now=Date.now()){
 const priority={repair:0,due:1,unseen:2};
 const ranked=relationshipCoverage(catalog,evidence,scope,now).filter(row=>row.kind!=='figure' && row.practiceState!=='waiting')
  .sort((a,b)=>priority[a.practiceState]-priority[b.practiceState] || (a.dueAt || 0)-(b.dueAt || 0));
 const queues=new Map();
 for(const row of ranked){if(!queues.has(row.objectiveId))queues.set(row.objectiveId,[]);queues.get(row.objectiveId).push(row);}
 const selected=[];
 while(selected.length<count && [...queues.values()].some(queue=>queue.length)){
  for(const queue of queues.values()){if(queue.length && selected.length<count)selected.push(queue.shift());}
 }
 return selected;
}
export function relationshipPrompt(targets=[]){
 if(!targets.length)return '';
 return '\nSOURCE-LOCATED OBJECTIVE RELATIONSHIPS (partial inventory, not medical certification):\n'+JSON.stringify(targets.map(row=>({id:row.id,facetId:row.facetId,objectiveId:row.objectiveId,label:row.label,quote:row.quote,page:row.page,practiceState:row.practiceState,dueAt:row.dueAt,previousQuestionKeys:row.previousQuestionKeys})))+'\nTest these relationships within the allocated parent objectives. For repair, distinguish the confused relationship with a supported near-transfer case. For due retests, use a genuinely fresh question in a new supported context, preserving the same relationship and requested reasoning depth. A familiar question or changed demographics alone is not a delayed fresh retest. Do not claim mastery or semantic transfer from wording changes. Return sourceRelationshipIds only for relationships actually required by the final question. Do not infer coverage from a label or incidental mention. The independent review must confirm the relationship IDs and exact assigned objective clause. Unsupported or figure-dependent relationships cannot receive text-only coverage.\n';
}
/** Bind only independent ownership/source review to the current catalog. */
export function bindReviewedRelationships(question,cfg={}) {
 question={...question};
 for(const key of ['objectiveFacetId','sourceRelationshipIds','relationshipSourceVersion','relationshipEvidence'])delete question[key];
 if(!hasReusableQuestionReview(question))return question;
 const claim=question.qualityAudit?.objectiveAlignment;
 const objective=(cfg.objectives || []).find(objective=>String(objective.id)===claim?.objectiveId);
 const clause=claim?.objectiveClause;
 if(!objective || !clause || !question.objectiveIds?.includes(String(objective.id)) || question.qualityAudit.objectiveId!==String(objective.id))return question;
 const pages=cfg.sourcePages || relationshipPages({},cfg.lectureText);
 const bundles=[];
 for(const quote of (question.reasoningAudit?.sourceQuotes || []).slice(0,3)){
  const page=pages.find(page=>norm(page.text).includes(norm(quote)));
  if(!page || String(quote).length>2400)continue;
  try{bundles.push(createSourceRelationship({blockId:cfg.blockId,lectureId:cfg.lectureId,objective,clause,label:question.objectiveFacet || clause,quote,page:page.page,pages}));}catch{/* An unresolved link receives no relationship coverage. */}
 }
 // Matching an existing source span alone is insufficient. The reviewer must name an ID.
 const known=(cfg.relationshipTargets || []).filter(row=>row.objectiveId===String(objective.id) && row.kind!=='figure' && question.qualityAudit?.relationshipIds?.includes(row.id));
 const ids=[...new Set([...bundles.map(bundle=>bundle.relationship.id),...known.map(row=>row.id)])];
 if(!ids.length)return question;
 return {...question,objectiveFacetId:bundles[0]?.facet.id || known[0]?.facetId,sourceRelationshipIds:ids,
  relationshipSourceVersion:relationshipSourceVersion(pages),relationshipEvidence:{version:1,bundles}};
}
