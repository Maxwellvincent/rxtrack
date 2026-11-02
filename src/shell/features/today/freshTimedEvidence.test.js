import {it,expect} from 'vitest';
import {freshTimedEvidence} from './freshTimedEvidence.js';
const q={questionId:'q',questionKey:'stable',lectureId:'l',sourceType:'question-bank',stem:'Source question',choices:{A:'One',B:'Two'},correct:'A'};
const timed={sessionId:'s',blockId:'nb2',status:'submitted',format:'exam',startedAt:2,deadline:10,questions:[q],answers:[{questionId:'q',value:'A'}]};
it('does not describe a repeated bank item as fresh timed evidence',()=>{
 const prior={...timed,sessionId:'prior',format:'practice',startedAt:1};
 expect(freshTimedEvidence([timed,prior],'nb2').total).toBe(0);
 expect(freshTimedEvidence([timed],'nb1').total).toBe(0);
});
it('includes skips in first-exposure timed results and identifies a mixed sample',()=>{
 const two={...q,questionId:'two',questionKey:'two',lectureId:'l2'};
 expect(freshTimedEvidence([{...timed,questions:[q,two]}],'nb2')).toMatchObject({total:2,correct:1,accuracy:0.5,mixed:true});
});
it('does not admit unreviewed generated questions or known key conflicts',()=>{
 expect(freshTimedEvidence([{...timed,questions:[{...q,sourceType:'generated'}]}],'nb2').total).toBe(0);
 expect(freshTimedEvidence([{...timed,questions:[{...q,correct:null,sourceKeyReviewStatus:'key-text-conflict'}]}],'nb2').total).toBe(0);
});
it('excludes a prior lecture-quiz exposure without letting a later answer rewrite the baseline',()=>{
 const prior=[{questionKey:'stable',ts:1,correct:true}];
 expect(freshTimedEvidence([timed],'nb2',{},prior).total).toBe(0);
 expect(freshTimedEvidence([timed],'nb2',{},[{...prior[0],ts:3}]).total).toBe(1);
});
