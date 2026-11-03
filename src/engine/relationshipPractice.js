/** Conservative scheduling heuristics, not mastery or exam-score predictions. */
export const RELATIONSHIP_RETEST_DAY=24*60*60*1000;
export const RELATIONSHIP_RETEST_POLICY='2026-11-02-delayed-fresh';
const isApplication=event=>event.reasoningVerified===true && ['second-order','third-order'].includes(event.orderLevel);
export function relationshipPractice(events=[],now=Date.now()){
 const answers=events.filter(event=>typeof event.correct==='boolean' && event.questionKey && Number.isFinite(event.at) && event.at>0 && event.at<=now)
  .sort((a,b)=>a.at-b.at);
 if(!answers.length)return {retestPolicy:RELATIONSHIP_RETEST_POLICY,practiceState:'unseen',dueAt:null,delayedFreshCorrect:0,delayedApplicationCorrect:0,repeatAnswers:0,transferStatus:'not-assessed',previousQuestionKeys:[]};
 const firstByKey=new Map(),delayed=[];
 let anchor=null,latestFailure=null,freshCorrect=null,spacedApplicationSuccesses=0;
 for(const event of answers){
  const fresh=!firstByKey.has(event.questionKey);
  if(fresh)firstByKey.set(event.questionKey,event);
  if(!event.correct){latestFailure=event;anchor=event;spacedApplicationSuccesses=0;continue;}
  if(!fresh)continue;
  const repaired=latestFailure && (!freshCorrect || latestFailure.at>=freshCorrect.at);
  freshCorrect=event;
  if(anchor && event.sessionKey && anchor.sessionKey && event.sessionKey!==anchor.sessionKey
    && event.questionKey!==anchor.questionKey && event.at-anchor.at>=RELATIONSHIP_RETEST_DAY){
   delayed.push(event);if(isApplication(event))spacedApplicationSuccesses++;
   anchor=event;
  }else if(!anchor || repaired){anchor=event;}
 }
 const repair=latestFailure && (!freshCorrect || latestFailure.at>=freshCorrect.at);
 // Repeated successes neither postpone fresh retests nor clear fresh-repair requirements.
 // Multiple fresh answers in one sitting cannot manufacture several spaced successes.
 const interval=spacedApplicationSuccesses>=2?7:spacedApplicationSuccesses===1?3:1;
 const dueAt=repair?latestFailure.at:anchor.at+interval*RELATIONSHIP_RETEST_DAY;
 return {retestPolicy:RELATIONSHIP_RETEST_POLICY,practiceState:repair?'repair':now>=dueAt?'due':'waiting',dueAt,
  delayedFreshCorrect:delayed.length,delayedApplicationCorrect:delayed.filter(isApplication).length,
  repeatAnswers:answers.length-firstByKey.size,transferStatus:'not-assessed',previousQuestionKeys:[...firstByKey.keys()].slice(-8)};
}
