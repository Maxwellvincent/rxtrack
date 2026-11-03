import {isEvaluationReserved,sourceItemId,emptySourceUse,stableRecordId} from './sourceUse.js';
export const ASSESSMENT_POLICY='2026-11-03-reserved-assessment';
const figureDigest=q=>stableRecordId([q.sourceImageUrl || q.sourceImageDataUrl || null,q.sourceFigureCropped===true],'figure');
const stemKey=q=>String(q.stem || '').normalize('NFKC').toLowerCase().replace(/[^a-z0-9]/g,'');
/** Exact-content checks only. Unknown external or paraphrased exposure stays unknown. */
export function beginReservedAssessment(current,questions,history,sessionId,at) {
 if(!sessionId || !questions.length)throw new Error('Choose reserved questions for this assessment.');
 if(current.assessmentRuns?.[sessionId])return {registry:current,snapshot:current.assessmentRuns[sessionId]};
 if(questions.some(q=>!isEvaluationReserved(q,current)))throw new Error('Reserve this entire bank for evaluation before starting a reserved assessment.');
 const priorIds=new Set(),priorStems=new Set();
 for(const session of history || [])for(const q of session.questions || []){priorIds.add(sourceItemId(q));if(stemKey(q))priorStems.add(stemKey(q));}
 const items=questions.map(q=>{
  const id=sourceItemId(q),previous=current.items?.[id] || {};
  const exposure=priorIds.has(id)||priorStems.has(stemKey(q)) ? 'recorded-practice'
   : Object.keys(previous.assessmentDeliveries || {}).length ? 'previous-assessment'
   : previous.firstContextAt || previous.exposure==='preparation-context' ? 'preparation-context' : 'unknown';
  return {sourceItemId:id,keyDigest:stableRecordId([id,q.correct],'key'),figureDigest:figureDigest(q),priorExposure:exposure};
 });
 const snapshot={policy:ASSESSMENT_POLICY,sessionId,startedAt:at,items,
  unknownPriorExposure:items.filter(item=>item.priorExposure==='unknown').length,
  knownPriorExposure:items.filter(item=>item.priorExposure!=='unknown').length,
  interpretation:'descriptive-only',semanticExposure:'not-assessed'};
 const registry={...emptySourceUse(),...current,items:{...current.items},assessmentRuns:{...current.assessmentRuns,[sessionId]:snapshot}};
 for(const q of questions){const id=sourceItemId(q),previous=registry.items[id] || {};
  registry.items[id]={...previous,assessmentDeliveries:{...previous.assessmentDeliveries,[sessionId]:at}};
 }
 if(new TextEncoder().encode(JSON.stringify(registry)).length>850000)throw new Error('Assessment exposure history is full. No assessment was started.');
 return {registry,snapshot};
}
/** Unanswered items count in assessment scores. Quality exclusions do not. */
export function reservedAssessmentResults(session,excludedIds=[]) {
 const excluded=new Set([...(session.scoringExcludedQuestionIds || []),...excludedIds]);
 const questions=(session.questions || []).filter(q=>!excluded.has(q.questionId));
 const answers=new Map((session.answers || []).map(a=>[a.questionId,a.value]));
 const score=qs=>{const correct=qs.filter(q=>answers.get(q.questionId)!=null && answers.get(q.questionId)===q.correct).length;
  const unanswered=qs.filter(q=>answers.get(q.questionId)==null).length;
  return {total:qs.length,correct,unanswered,incorrect:qs.length-correct-unanswered,percent:qs.length?Math.round(100*correct/qs.length):null};};
 const groups=field=>{
  const buckets=new Map();
  for(const q of questions){const ids=field==='objectiveIds' ? q.objectiveIds || [] : q.lectureId?[q.lectureId]:[];
   for(const id of ids.length?ids:['unlinked']){if(!buckets.has(id))buckets.set(id,[]);buckets.get(id).push(q);}
  }
  return [...buckets].map(([id,qs])=>({id,...score(qs)})).sort((a,b)=>(a.percent??101)-(b.percent??101)||a.id.localeCompare(b.id));
 };
 return {...score(questions),excluded:(session.questions || []).length-questions.length,lectures:groups('lectureId'),objectives:groups('objectiveIds')};
}

/** Prospective pairing infrastructure only; unknown exposure never becomes a clean holdout claim. */
export function compareReservedAssessments(blockId,sessions=[],reports=[]) {
 const unique=new Map(sessions.filter(s=>s.sessionId).map(s=>[s.sessionId,s]));
 const eligible=[...unique.values()].filter(s=>s.blockId===blockId && s.purpose==='reserved-assessment'
  && s.format==='exam' && s.status==='submitted' && s.assessment?.policy===ASSESSMENT_POLICY && s.assessment.sessionId===s.sessionId && s.questions?.length
  && s.assessment.items.length===s.questions.length && new Set(s.assessment.items.map(item=>item.sourceItemId)).size===s.questions.length
  && s.questions.every(q=>s.assessment.items.some(item=>item.sourceItemId===sourceItemId(q) && item.keyDigest===stableRecordId([sourceItemId(q),q.correct],'key') && item.figureDigest===figureDigest(q))));
 return reports.filter(r=>r.blockId===blockId).map(report=>{
  const end=Date.parse(report.date+'T00:00:00');
  const prior=eligible.filter(s=>{const at=typeof s.submittedAt==='number'?s.submittedAt:Date.parse(s.submittedAt);return at<end && at>=end-7*86400000;});
  const reference=prior.filter(s=>s.assessment.knownPriorExposure===0);
  const scored=reference.map(s=>reservedAssessmentResults(s));
  const total=scored.reduce((n,s)=>n+s.total,0),correct=scored.reduce((n,s)=>n+s.correct,0);
  return {reportId:report.id,name:report.name,kind:report.kind,date:report.date,schoolPercent:report.percent,
   assessmentCount:reference.length,exposedSittingsExcluded:prior.length-reference.length,questionCount:total,assessmentPercent:total?100*correct/total:null,
   knownPriorExposure:prior.reduce((n,s)=>n+s.assessment.knownPriorExposure,0),
   unknownPriorExposure:reference.reduce((n,s)=>n+s.assessment.unknownPriorExposure,0),interpretation:'descriptive-only'};
 });
}
