import {it,expect} from 'vitest';
import {sessionEvidenceEvent} from './sessionEvidence.js';
const session={sessionId:'s',blockId:'NB',questions:[]};
const question={id:'q1',questionId:'bank:first:q1',sourceType:'question-bank',stem:'Which cell supports the blood brain barrier?',choices:{A:'Astrocyte',B:'Microglia'},correct:'A'};
it('distinguishes repeated local bank IDs by question content',()=>{
 const one=sessionEvidenceEvent({...session,questions:[question]},question,{value:'A',answeredAt:1});
 const other={...question,questionId:'bank:second:q1',stem:'Which cell creates central nervous system myelin?',choices:{A:'Oligodendrocyte',B:'Microglia'}};
 const two=sessionEvidenceEvent({...session,questions:[other]},other,{value:'A',answeredAt:1});
 expect(one.questionKey).not.toBe(two.questionKey);expect(one.legacyQuestionKey).toBe('q1');
 const repeat=sessionEvidenceEvent({...session,questions:[question]}, {...question,questionId:'retake:q1'}, {value:'B',answeredAt:2});
 expect(repeat.questionKey).toBe(one.questionKey);
});
it('retains concept and facet tags through saved school/exam evidence',()=>{
 const tagged={...question,sourceConceptKeys:['astrocyte'],objectiveFacet:'barrier support'};
 expect(sessionEvidenceEvent({...session,questions:[tagged]},tagged,{value:'A'})).toMatchObject({sourceConceptKeys:['astrocyte'],objectiveFacet:'barrier support'});
});
it('carries assistance through checkpoints and finalization without removing the actual answer',()=>{
 const q={...question,assistance:{used:true,turns:2}};
 expect(sessionEvidenceEvent({...session,questions:[q]},q,{value:'A'})).toMatchObject({correct:true,assisted:true,assistance:{used:true,kind:'help-me-reason',turns:2}});
});
