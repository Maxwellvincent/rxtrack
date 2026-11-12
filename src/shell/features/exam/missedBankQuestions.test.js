import {it,expect} from 'vitest';
import {missedBankQuestions} from './missedBankQuestions.js';
const q={id:'q',questionId:'attempt:q',stem:'Which pathway carries pain?',choices:{A:'Spinothalamic',B:'Dorsal column'},correct:'A'};
const bank={filename:'Homework',aliases:['Old name'],questions:[q]};
const session=(value,at,extra={})=>({blockId:'nb2',sourceFile:'Homework',status:'submitted',questions:[q],answers:[{questionId:q.questionId,value,answeredAt:at}],...extra});
const select=sessions=>missedBankQuestions({bank,sessions,blockId:'nb2'});
it('collects saved misses, deduplicates retakes, and clears only after a later correct answer',()=>{
 expect(select([session('B',1),session('B',2)])).toEqual([q]);
 expect(select([session('A',3),session('B',1)])).toEqual([]);
 expect(select([session('A',1),session('B',3)])).toEqual([q]);
});
it('includes partial saved homework without requiring the entire bank to be finished',()=>{
 expect(select([session(null,0,{status:'in_progress',checkpointAnswers:[{questionId:q.questionId,value:'B',answeredAt:1}]})])).toEqual([q]);
});
it('ignores unanswered, other blocks, other banks and withdrawn key problems',()=>{
 expect(select([session(null,1),session('B',1,{blockId:'nb1'}),session('B',1,{sourceFile:'Other'})])).toEqual([]);
 expect(select([session('B',1,{questions:[{...q,correct:null,sourceKeyReviewStatus:'key-text-conflict'}]})])).toEqual([]);
});
it('honours aliases and does not carry old mistakes into a changed source question',()=>{
 expect(select([session('B',1,{sourceFile:'Old name'})])).toEqual([q]);
 expect(missedBankQuestions({bank:{...bank,questions:[{...q,stem:'Different question'}]},sessions:[session('B',1)],blockId:'nb2'})).toEqual([]);
});
it('keeps reported bad keys out of the missed-question queue',()=>{
 const ratings={bad:{sourceIssue:'incorrect-key',evidenceAliases:[`stem:${q.stem}`]}};
 expect(missedBankQuestions({bank,sessions:[session('B',1)],blockId:'nb2',ratings})).toEqual([]);
});
it('does not revive an old miss when a completed attempt later receives a metadata update',()=>{
 const old=session('B',null,{submittedAt:1,updatedAt:100});
 const fixed=session('A',null,{submittedAt:2,updatedAt:2});
 expect(select([old,fixed])).toEqual([]);
});
it('does not clear an earlier independent miss after assisted success',()=>{
 const q={questionId:'q',stem:'Which pathway?',choices:{A:'One',B:'Two'},correct:'A'};
 const bank={filename:'NB.pdf',questions:[q]};
 const make=(at,value,assistance)=>({sessionId:`s${at}`,status:'submitted',blockId:'b',sourceFile:'NB.pdf',questions:[{...q,assistance}],answers:[{questionId:'q',value,answeredAt:at}]});
 expect(missedBankQuestions({bank,blockId:'b',sessions:[make(1,'B'),make(2,'A',{used:true})]})).toHaveLength(1);
 expect(missedBankQuestions({bank,blockId:'b',sessions:[make(1,'B'),make(2,'A')]})).toHaveLength(0);
});
