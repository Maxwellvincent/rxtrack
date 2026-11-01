import {it,expect} from 'vitest';
import {repairSessionSource} from './repairSessionSource.js';
it('restores source choices while preserving IDs and pick meaning, holding conflicting keys',()=>{
 const q={questionId:'stable',sourceSection:'NB 28',sourceQuestionNumber:37,stem:'Original exact stem',choices:{A:'Left stereognosis',B:'Right stereognosis'},correct:'A',objectiveIds:['o1']};
 const result=repairSessionSource({questions:[q],answers:[{questionId:'stable',value:'B',revealed:true}]},[{...q,choices:{...q.choices,I:'Another original choice'},correct:null,sourceKeyCandidate:'A',sourceKeyReviewStatus:'key-text-conflict'}]);
 expect(result.questions[0]).toMatchObject({questionId:'stable',correct:null,objectiveIds:['o1'],choices:{I:'Another original choice'},sourceOriginalKey:'A'});
 expect(result.answers[0]).toMatchObject({questionId:'stable',value:'B'});
 expect(q.correct).toBe('A');
});
it('refuses different stems, ambiguous identities, and unmatched selected option meanings',()=>{
 const q={questionId:'q',sourceSection:'NB27',sourceQuestionNumber:1,stem:'Original stem',choices:{A:'Old text'},correct:'A'};
 const session={questions:[q],answers:[{questionId:'q',value:'A'}]};
 for(const originals of [[{...q,stem:'Different stem'}],[q,q],[{...q,choices:{A:'New text'}}]])expect(repairSessionSource(session,originals).questions[0]).toBe(q);
});
it('matches a retained visual-label pick to the same printed label after source reparse',()=>{
 const q={questionId:'q',sourceSection:'NB28',sourceQuestionNumber:1,stem:'Which labeled site?',choices:{A:'Visual option A',B:'Visual option B'},correct:'A'};
 const repaired=repairSessionSource({questions:[q],answers:[{questionId:'q',value:'B'}]},[{...q,choices:{A:'A',B:'B',F:'F'}}]);
 expect(repaired.questions[0].choices.F).toBe('F');expect(repaired.answers[0].value).toBe('B');
});
