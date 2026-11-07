import {it,expect} from 'vitest';import {reconcileLectureStats} from './reconcileLectureStats.js';
const lectures=[{id:'l',blockId:'b',lectureNumber:27,lectureTitle:'NB 27 Section Anatomy of the CNS'}];
const q={questionId:'q',stem:'A question?',correct:'A',choices:{A:'One',B:'Two'},lectureId:'l'};
const session={sessionId:'s',blockId:'b',isCheckpoint:true,questions:[q],answers:[{questionId:'q',value:'B'}]};
it('counts saved partial answers and preserves retakes but deduplicates mirrored sessions',()=>{
 expect(reconcileLectureStats({},[session,session],lectures,'b').l).toMatchObject({answered:1,correct:0});
 expect(reconcileLectureStats({},[session,{...session,sessionId:'retake'}],lectures,'b').l.answered).toBe(2);
});
it('does not add a checkpoint or finalized answer already reflected in lecture counters',()=>{
 const stats={l:{answered:10,correct:8,checkpointEventIds:['exam:s:q']}};
 expect(reconcileLectureStats(stats,[session],lectures,'b').l.answered).toBe(10);
 expect(reconcileLectureStats({l:{answered:10,correct:8}},[{...session,isCheckpoint:false,sideEffectsCompleted:{statsRecordedQuestionIds:['q']}}],lectures,'b').l.answered).toBe(10);
});
it('recovers a source-number-linked homework answer using the same projection for every priority view',()=>{
 const old={...session,isCheckpoint:false,questions:[{...q,lectureId:null,sourceType:'question-bank',sourceSection:'NB 27',sourceSectionTitle:'Section Anatomy of the CNS'}]};
 expect(reconcileLectureStats({},[old],lectures,'b').l).toMatchObject({answered:1,correct:0});
 expect(reconcileLectureStats({},[{...old,blockId:'other'}],lectures,'b')).toEqual({});
});
it('uses all 20 latest quiz answers for priority without adding them again to lifetime totals',()=>{
 const study=Array.from({length:20},(_,i)=>({lectureId:'l',blockId:'b',correct:i<17,ts:10000+i,sessionKey:'new'}));
 const result=reconcileLectureStats({l:{answered:39,correct:27}},[],lectures,'b',study);
 expect(result.l).toMatchObject({answered:39,correct:27});expect(result.l.recentAnswers).toHaveLength(20);expect(result.l.recentAnswers.filter(a=>a.correct)).toHaveLength(17);
});
