import {it,expect} from 'vitest';
import {relationshipPractice,RELATIONSHIP_RETEST_DAY as day} from './relationshipPractice.js';
const e=(questionKey,at,extra={})=>({questionKey,at,correct:true,sessionKey:`session-${at}`,orderLevel:'second-order',reasoningVerified:true,...extra});
it('keeps unattempted records unseen and unknown evidence ungraded',()=>{
 expect(relationshipPractice([],day)).toMatchObject({practiceState:'unseen',transferStatus:'not-assessed'});
 expect(relationshipPractice([e('q',0),e('q',2*day),e('q',1,{correct:null})],day).practiceState).toBe('unseen');
});
it('waits one full day before a fresh relationship retest',()=>{
 const event=e('q1',100);
 expect(relationshipPractice([event],day)).toMatchObject({practiceState:'waiting',dueAt:day+100});
 expect(relationshipPractice([event],day+100).practiceState).toBe('due');
});
it('does not turn repeated answers into delayed success or postpone a due retest',()=>{
 const events=[e('q1',100),e('q1',2*day)];
 expect(relationshipPractice(events,2*day)).toMatchObject({practiceState:'due',dueAt:day+100,repeatAnswers:1,delayedFreshCorrect:0});
});
it('requires a fresh question in a different session after a real delay',()=>{
 const first=e('q1',100);
 expect(relationshipPractice([first,e('q2',day+100,{sessionKey:first.sessionKey})],day+100).delayedFreshCorrect).toBe(0);
 expect(relationshipPractice([first,e('q2',day+100)],day+100)).toMatchObject({delayedFreshCorrect:1,delayedApplicationCorrect:1,dueAt:4*day+100,practiceState:'waiting',transferStatus:'not-assessed'});
});
it('counts delayed recognition separately from verified application',()=>{
 const events=[e('q1',100),e('q2',day+100,{orderLevel:'first-order'})];
 expect(relationshipPractice(events,day+100)).toMatchObject({delayedFreshCorrect:1,delayedApplicationCorrect:0});
});
it('keeps a miss due until fresh successful evidence arrives',()=>{
 const events=[e('q1',100,{correct:false}),e('q1',200)];
 expect(relationshipPractice(events,300).practiceState).toBe('repair');
 expect(relationshipPractice([...events,e('q2',300)],400)).toMatchObject({practiceState:'waiting',delayedFreshCorrect:0});
});
it('a later repeated miss returns a previously successful relationship to repair',()=>{
 const events=[e('q1',100),e('q2',day+100),e('q1',day+200,{correct:false})];
 expect(relationshipPractice(events,day+300)).toMatchObject({practiceState:'repair',dueAt:day+200});
});
it('does not manufacture multiple spaced successes from a single follow-up sitting',()=>{
 const events=[e('q1',100),e('q2',day+100,{sessionKey:'followup'}),e('q3',day+200,{sessionKey:'followup'})];
 expect(relationshipPractice(events,day+300)).toMatchObject({delayedFreshCorrect:1,dueAt:4*day+100});
});
it('resets spacing after a new miss and requires fresh correction',()=>{
 const events=[e('q1',100),e('q2',day+100),e('q3',2*day+100,{correct:false}),e('q4',2*day+200)];
 expect(relationshipPractice(events,2*day+300)).toMatchObject({practiceState:'waiting',dueAt:3*day+200});
});
it('requires independent evidence for delayed retests even after guided success',()=>{
 expect(relationshipPractice([e('q',1,{assisted:true})],day)).toMatchObject({practiceState:'unseen',delayedFreshCorrect:0});
});
it('preserves coached exposure so an original retry cannot clear a fresh repair requirement',()=>{
 const result=relationshipPractice([e('miss',1,{correct:false}),e('coached',2,{assisted:true}),e('coached',day+3)],day+4);
 expect(result).toMatchObject({practiceState:'repair',delayedFreshCorrect:0,repeatAnswers:1});
 expect(relationshipPractice([e('coached',1,{assisted:true}),e('coached',day+2)],day+3)).toMatchObject({practiceState:'unseen',delayedFreshCorrect:0});
});
