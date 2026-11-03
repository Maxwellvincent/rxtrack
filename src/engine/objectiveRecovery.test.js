import {it,expect} from 'vitest';
import {objectiveRecovery,minimumRecoveryQuestions} from './objectiveRecovery.js';
import {objectivePracticePlan} from './objectivePractice.js';
const DAY=86400000;
const answers=Array.from({length:5},(_,i)=>({questionKey:`q${i}`,correct:i!==0,at:1000+i*DAY,
 sessionKey:`s${i}`,taskType:i%2?'mechanism':'clinical-application',orderLevel:'second-order',reasoningVerified:true}));
it('recognizes varied spaced recovery while keeping lifetime accuracy',()=>{
 const row=objectivePracticePlan([{id:'o'}],{objectives:{o:{attempts:50,correct:10,recent:[true,true,true],sessions:['a','b'],taskTypes:{a:1,b:1},recentFreshAnswers:answers}}}).rows[0];
 expect(row.ready).toBe(true);expect(row.accuracy).toBe(.2);expect(row.readinessBasis).toBe('recent-fresh-recovery');expect(row.missingRequirements).not.toContain('repair missed connections');
});
it('blocks repeated items, one sitting, unverified depth and latest misses',()=>{
 expect(objectiveRecovery(answers).recovered).toBe(true);
 expect(objectiveRecovery(answers.map(a=>({...a,questionKey:'same'}))).recovered).toBe(false);
 expect(objectiveRecovery(answers.map(a=>({...a,sessionKey:'same'}))).recovered).toBe(false);
 expect(objectiveRecovery(answers.map(a=>({...a,at:1000}))).recovered).toBe(false);
 expect(objectiveRecovery(answers.map(a=>({...a,reasoningVerified:false}))).recovered).toBe(false);
 expect(objectiveRecovery(answers,false).recovered).toBe(false);
});
it('does not infer fresh evidence from legacy totals and bounds future work without recording it',()=>{
 expect(objectiveRecovery([]).recovered).toBe(false);
 expect(minimumRecoveryQuestions([],false)).toBe(5);
 expect(minimumRecoveryQuestions(answers,true)).toBe(0);
 expect(answers).toHaveLength(5);
});
