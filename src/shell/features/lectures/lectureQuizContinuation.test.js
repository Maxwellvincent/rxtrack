import {it,expect} from 'vitest';
import {schoolContinuationQuestions} from './lectureQuizContinuation.js';
const lecture={id:'l',blockId:'b',lectureNumber:9,lectureTitle:'NB 09 Neurotransmitter Pathways and Roles'};
const question=n=>({id:`q${n}`,stem:`A patient with clinical presentation ${n} has abnormal neurotransmitter release. Which relationship best explains the findings in this particular case?`,choices:{A:`Relationship ${n}`,B:'Alternative pathway'},correct:'A',sourceSection:'NB 09',sourceSectionTitle:'Neurotransmitter Pathways and Roles'});
const args={lecture,blockId:'b',missing:2,difficulty:'medium',banks:{'Homework.pdf':[question(1),question(2)]},metadata:{hw:{filename:'Homework.pdf',blockId:'b'}}};
it('recovers the last two slots from authentic same-lecture questions without inventing advanced credit',()=>{
 const result=schoolContinuationQuestions(args);
 expect(result).toHaveLength(2);
 expect(result.every(q=>q.lectureId==='l'&&q.sourceType==='question-bank'&&q.correct==='A')).toBe(true);
 expect(result.every(q=>q.objectiveIds.length===0&&!q.reasoningAudit)).toBe(true);
});
it('does not reuse seen, incomplete, excluded, or unrelated items',()=>{
 expect(schoolContinuationQuestions({...args,history:[question(1),question(2)]})).toHaveLength(0);
 expect(schoolContinuationQuestions({...args,banks:{'Homework.pdf':[{...question(1),hasImage:true},{...question(2),sourceSection:'NB 08',sourceSectionTitle:'Synaptic Transmission'}]}})).toHaveLength(0);
 expect(schoolContinuationQuestions({...args,ratings:{r:{sourceIssue:'invalid-choices',evidenceKey:'q1'}}})).toHaveLength(1);
});
it('does not substitute unverified school items for an explicitly harder quiz or a large missing batch',()=>{
 expect(schoolContinuationQuestions({...args,difficulty:'hard'})).toEqual([]);
 expect(schoolContinuationQuestions({...args,missing:10})).toEqual([]);
});
it('carries the saved source figure into the lecture quiz renderer',()=>{
 const result=schoolContinuationQuestions({...args,banks:{'Homework.pdf':[{...question(3),hasImage:true,sourceImageUrl:'https://example.com/crop.jpg'}]}});
 expect(result[0].image.url).toBe('https://example.com/crop.jpg');
});
