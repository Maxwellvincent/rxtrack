import {it,expect,vi} from 'vitest';
import {auditQuestionAccuracy,evaluateAccuracyReview} from './questionAccuracyAudit.js';
const source='The supplied source states that structure Alpha controls response Beta. '.repeat(5);
const q={stem:'Which structure controls response Beta?',choices:{A:'Alpha',B:'Gamma'},correct:'A',explanation:'Alpha controls Beta.',objectiveIds:['o']};
const review={answer:'A',unique:true,objectiveAligned:true,explanationAccurate:true,sourceQuotes:['structure Alpha controls response Beta.'],choiceReasons:{A:'The supplied source supports Alpha.',B:'The supplied source does not support Gamma.'}};
it('requires exact source support, one answer, every choice rationale and alignment',()=>{
 expect(evaluateAccuracyReview(q,review,source).status).toBe('ai-check-passed');
 for(const patch of [{answer:'B'},{unique:false},{sourceQuotes:['Fabricated source says something different.']},{choiceReasons:{A:'Only one choice was reviewed.'}},{objectiveAligned:false},{explanationAccurate:false}])expect(evaluateAccuracyReview(q,{...review,...patch},source).status).toBe('needs-review');
});
it('withholds the answer key and explanation from the solver and never rewrites the item',async()=>{
 const call=vi.fn().mockResolvedValueOnce(review).mockResolvedValueOnce({explanationAccurate:true});
 const before=JSON.stringify(q);
 expect((await auditQuestionAccuracy(q,{source,callAIJSON:call})).status).toBe('ai-check-passed');
 const prompt=call.mock.calls[0][1];
 expect(prompt).not.toContain('"correct":"A"');expect(prompt).not.toContain(q.explanation);
 expect(JSON.stringify(q)).toBe(before);
});
it('does not certify visual items or missing sources with a text-only solver',async()=>{
 const call=vi.fn();
 expect((await auditQuestionAccuracy({...q,hasImage:true},{source,callAIJSON:call})).status).toBe('unverified');
 expect((await auditQuestionAccuracy(q,{source:'',callAIJSON:call})).status).toBe('unverified');
 expect(call).not.toHaveBeenCalled();
});
