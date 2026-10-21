import {it,expect} from 'vitest';
import {lectureCompletion} from './lectureCompletion.js';
it('completes first pass with reviewed and incorrectly answered objectives without claiming mastery',()=>{
 const result=lectureCompletion([{id:'reviewed',reviewedAt:1},{id:'tested'}],{objectives:{tested:{attempts:1,correct:0,recent:[false]}}});
 expect(result).toMatchObject({covered:2,complete:true,tested:1,reviewed:1,remaining:0});
});
it('requires each objective and does not treat absent objectives as completed',()=>{
 expect(lectureCompletion([{id:'r',status:'mastered'},{id:'u'}]).complete).toBe(false);
 expect(lectureCompletion([]).complete).toBe(false);
});
