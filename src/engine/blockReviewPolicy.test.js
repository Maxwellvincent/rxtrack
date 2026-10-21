import {it,expect} from 'vitest';
import {blockReviewPolicy,contextBlockReviewPolicy} from './blockReviewPolicy.js';
it('pauses after the exam day, retaining exam-day access',()=>{
 const block={examDate:'2026-10-23',status:'active'};
 expect(blockReviewPolicy(block,new Date(2026,9,23,23,59)).suspended).toBe(false);
 expect(blockReviewPolicy(block,new Date(2026,9,24,0,1)).suspended).toBe(true);
});
it('pauses completed blocks even without a date and leaves unknown dates active',()=>{
 expect(blockReviewPolicy({status:'complete'}).suspended).toBe(true);
 expect(blockReviewPolicy({status:'active',examDate:'invalid'}).suspended).toBe(false);
});
it('uses the selected block schedule without suspending a later CBSE block',()=>{
 const terms=[{blocks:[{id:'NB',examDate:'2026-10-23'},{id:'CBSE',kind:'cbse',examDate:'2026-12-09'}]}];
 const now=new Date(2026,9,24);
 expect(contextBlockReviewPolicy({blockId:'NB',terms,now}).suspended).toBe(true);
 expect(contextBlockReviewPolicy({blockId:'CBSE',terms,now}).suspended).toBe(false);
});
