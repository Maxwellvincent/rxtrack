import {it,expect} from 'vitest';
import {refreshQuestionBank} from './questionBankRefresh.js';
const old={id:'q1',stem:'Which pathway?',choices:{A:'One',B:'Two'},correct:'A',objectiveIds:['objective-1'],importedAt:'yesterday',sourceImageUrl:'figure'};
it('retains answer identities and mapped links across reordered daily decks',()=>{
 const r=refreshQuestionBank([old],[{...old,id:'new-slide-id',objectiveIds:[],importedAt:'today'}, {id:'q2',stem:'Another question',choices:{A:'One',B:'Two'},correct:'B'}]);
 expect(r.questions[0]).toMatchObject({id:'q1',objectiveIds:['objective-1'],importedAt:'yesterday',sourceImageUrl:'figure'});
 expect(r).toMatchObject({added:1,unchanged:1});
 expect(refreshQuestionBank(r.questions,r.questions).questions).toHaveLength(2);
});
it('keeps removed items and gives changed content a separate identity from past scores',()=>{
 const r=refreshQuestionBank([old],[{...old,correct:'B'}]);
 expect(r.questions).toHaveLength(2);expect(r.questions[0]).toEqual(old);
 expect(r.questions[1].id).not.toBe(old.id);
 expect(refreshQuestionBank(r.questions,[{...old,correct:'B'}]).questions).toHaveLength(2);
});
it('keeps prior figures intact and treats a changed image as a new question revision',()=>{
 const prior={...old,sourceImageFingerprint:'first-image'};
 const same=refreshQuestionBank([prior],[{...prior,sourceImageDataUrl:'new-render'}]);
 expect(same.questions[0].sourceImageUrl).toBe('figure');expect(same.questions[0].sourceImageDataUrl).toBeUndefined();
 const changed=refreshQuestionBank([prior],[{...prior,sourceImageFingerprint:'changed-image',sourceImageDataUrl:'changed-render'}]);
 expect(changed.questions).toHaveLength(2);expect(changed.questions[1].id).not.toBe(prior.id);expect(changed.questions[0].sourceImageUrl).toBe('figure');
});
