import {isIndependentAttempt} from './practiceAssistance.js';
import {questionIsExcluded} from './questionScoringPolicy.js';
import {schoolQuestionIdentity} from '../shell/features/exam/schoolSourceIdentity.js';
import {missingRequiredVisual} from './questionVisual.js';

export const READINESS_POLICY = 'fresh-timed-proxy-v1';
const identity=q=>schoolQuestionIdentity({...q,correct:q.correct || q.correctLetter});
export function readinessSnapshot({blockId,lectureIds,objectives=[],sessions=[],evidence={},ratings={},weights={},now=Date.now()}) {
 const scope=new Set(lectureIds),seen=new Set(),records=[],excluded={repeated:0,assisted:0,recovered:0,incomplete:0,quality:0};
 // Account-wide first exposure, including prior quizzes and guided answers.
 const exposures=[...(evidence.learningJournal||[]),...(evidence.assistedJournal||[])].filter(e=>e.learningContext?.stem&&Number(e.at)<=now).sort((a,b)=>a.at-b.at);
 let index=0;
 const candidates=[...sessions].filter(s=>s.blockId===blockId&&Number(s.submittedAt)>0&&Number(s.submittedAt)<=now&&s.status==='submitted').sort((a,b)=>Number(a.startedAt||a.submittedAt)-Number(b.startedAt||b.submittedAt));
 for(const session of candidates){
  const at=Number(session.startedAt||session.submittedAt);
  while(index<exposures.length&&Number(exposures[index].at)<at){seen.add(identity(exposures[index++].learningContext));}
  const answers=new Map((session.answers||[]).map(a=>[a.questionId,a]));
  const complete=session.format==='exam'&&Number.isFinite(session.startedAt)&&Number.isFinite(session.deadline)&&(!session.targetQuestionCount||(session.questions||[]).length>=session.targetQuestionCount);
  for(const q of session.questions||[]){
   const id=identity(q),prior=seen.has(id);seen.add(id);
   if(!scope.has(q.lectureId))continue;
   const answer=answers.get(q.questionId);
   if(session.timingRecovery){excluded.recovered++;continue;}
   if(!complete){excluded.incomplete++;continue;}
   if(prior){excluded.repeated++;continue;}
   if(!isIndependentAttempt(q)||!isIndependentAttempt(answer||{})){excluded.assisted++;continue;}
   if(questionIsExcluded(q,ratings)||choiceAuditIssues(q).length||missingRequiredVisual(q)||['needs-review','unsupported-by-lecture'].includes(q.sourceKeyReviewStatus)||(q.sourceType!=='question-bank'&&(q.generationVersion!=='v2'||q.qualityAudit?.status!=='approved'||q.qualityAudit?.blindSolve?.status!=='matched'))){excluded.quality++;continue;}
   if(Number(session.submittedAt)<now-30*86400000)continue;
   records.push({id,sessionId:session.sessionId,lectureId:q.lectureId,objectiveIds:q.objectiveIds||[],correct:answer?.value===q.correct,source:q.sourceFile||q.sourceType||'generated'});
  }
 }
 const scopedObjectives=objectives.filter(o=>scope.has(o.linkedLecId||o.lectureId));
 const covered=new Set(records.flatMap(r=>r.objectiveIds));
 const coverage=scopedObjectives.length?scopedObjectives.filter(o=>covered.has(o.id)).length/scopedObjectives.length:0;
 const byLecture=lectureIds.map(id=>{const rows=records.filter(r=>r.lectureId===id);return {id,total:rows.length,correct:rows.filter(r=>r.correct).length,weight:Number(weights[id])>0?Number(weights[id]):1};});
 const sampled=byLecture.filter(l=>l.total),weight=sampled.reduce((n,l)=>n+l.weight,0);
 const practicePercent=weight?100*sampled.reduce((n,l)=>n+l.weight*l.correct/l.total,0)/weight:null;
 const sessionCount=new Set(records.map(r=>r.sessionId)).size;
 const sufficient=records.length>=30&&sessionCount>=2&&coverage>=0.7&&sampled.length===lectureIds.length&&lectureIds.length>0;
 return {policy:READINESS_POLICY,createdAt:now,blockId,lectureIds,windowDays:30,weights:Object.fromEntries(byLecture.map(l=>[l.id,l.weight])),goal:80,practicePercent,estimatePercent:sufficient?practicePercent:null,sufficient,total:records.length,sessionCount,objectiveCoverage:coverage,objectiveTotal:scopedObjectives.length,byLecture,excluded,evidenceIds:records.map(r=>r.id),limitations:['Practice-based proxy; not a validated school-score prediction.','First recorded exposure cannot detect questions seen outside RXTrack.','Equal lecture weighting unless school weights are supplied.'],auditStatus:'Automated generation checks only; independent human validation not established.'};
}
export function compareActual(snapshot,actual){
 if(!Number.isFinite(actual.correct)||!Number.isInteger(actual.correct)||!Number.isInteger(actual.total)||actual.total<=0||actual.correct<0||actual.correct>actual.total)throw new Error('Enter valid correct and total question counts.');
 if(!Number.isFinite(actual.takenAt)||actual.takenAt<=snapshot.createdAt)throw new Error('The test must be taken after the estimate was saved.');
 const percent=100*actual.correct/actual.total;
 return {...actual,percent,goalMet:percent>=snapshot.goal,gapToGoal:percent-snapshot.goal,errorPoints:snapshot.estimatePercent==null?null:percent-snapshot.estimatePercent};
}

export function choiceAuditIssues(q){
 const entries=Object.entries(q.choices||{}),norm=v=>String(v||'').toLowerCase().replace(/\s+/g,' ').trim();
 const issues=[];
 if(entries.length<2||entries.some(([,v])=>!norm(v)))issues.push('Missing or blank choices');
 if(!Object.hasOwn(q.choices||{},q.correct))issues.push('Key does not point to a displayed choice');
 if(new Set(entries.map(([,v])=>norm(typeof v==='object'?JSON.stringify(v):v))).size!==entries.length)issues.push('Duplicate answer choices');
 return issues;
}
export function randomAuditSample(questions,count=10,random=()=>crypto.getRandomValues(new Uint32Array(1))[0]/4294967296){
 const unique=[...new Map(questions.map(q=>[identity(q),q])).values()];
 for(let i=unique.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[unique[i],unique[j]]=[unique[j],unique[i]];}
 return unique.slice(0,count);
}
