import {protectSessionScoring,evidenceIdentity} from '../../../engine/questionScoringPolicy.js';
/** First recorded exposure, not proof the learner has never seen an item elsewhere. */
export function freshTimedEvidence(sessions=[],blockId,ratings={},studyAnswers=[]){
 const seen=new Set(),lectureIds=new Set();let total=0,correct=0,sessionCount=0;
 const exposures=studyAnswers.filter(a=>typeof a.correct==='boolean'&&Number.isFinite(a.ts||a.at)).map(a=>({key:evidenceIdentity(a.questionKey||a.stem),at:a.ts||a.at})).filter(a=>a.key).sort((a,b)=>a.at-b.at);
 let exposureIndex=0;
 for(const session of [...sessions].filter(s=>s.blockId===blockId).sort((a,b)=>(a.startedAt||a.submittedAt||0)-(b.startedAt||b.submittedAt||0))){
  const sessionAt=Number(session.startedAt||session.submittedAt)||0;
  while(exposureIndex<exposures.length&&exposures[exposureIndex].at<=sessionAt){seen.add(exposures[exposureIndex++].key);}
  const snapshot=protectSessionScoring(session,ratings);
  const answers=new Map((session.status==='in_progress'?session.checkpointAnswers||[]:snapshot.answers||[]).filter(a=>a.value!=null).map(a=>[a.questionId,a]));
  const excluded=new Set(snapshot.scoringExcludedQuestionIds||[]);
  const timed=session.status==='submitted'&&session.format==='exam'&&Number.isFinite(session.deadline);
  let used=false;
  for(const q of session.questions||[]){
   const identity=evidenceIdentity(q.questionKey||q.poolId||q.stem);
   if(!identity)continue;
   const prior=seen.has(identity);
   if(answers.has(q.questionId)||timed)seen.add(identity);
   if(!timed||prior||!q.correct||excluded.has(q.questionId))continue;
   if(q.sourceType!=='question-bank'&&(q.generationVersion!=='v2'||q.qualityAudit?.status!=='approved'))continue;
   if(['needs-review','unsupported-by-lecture'].includes(q.sourceKeyReviewStatus))continue;
   total++;used=true;
   if(answers.get(q.questionId)?.value===q.correct)correct++;
   if(q.lectureId)lectureIds.add(q.lectureId);
  }
  if(used)sessionCount++;
 }
 return {total,correct,accuracy:total?correct/total:null,sessionCount,lectureCount:lectureIds.size,mixed:lectureIds.size>=2};
}
