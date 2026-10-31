import {expect,it} from 'vitest';
import {discriminationIssue,verifiedDiscrimination} from './questionDiscrimination.js';
const q={stem:'The response persists after the upstream input is blocked. Which mechanism applies?',choices:{A:'Local response',B:'Upstream response'},correct:'A'};
const claim={closestAlternative:'B',stemClue:'persists after the upstream input is blocked',whyAlternativeFails:'The preserved response cannot require the blocked input.',keyUniquelySupported:true,alternativeAlsoCorrect:false};
it('requires an actual non-key alternative and a clue in the final stem',()=>{
 expect(verifiedDiscrimination(claim,q)).toEqual(claim);
 for(const patch of [{closestAlternative:'A'},{closestAlternative:'F'},{stemClue:'An invented finding not in the stem'},{alternativeAlsoCorrect:true},{keyUniquelySupported:false},{whyAlternativeFails:''}])expect(verifiedDiscrimination({...claim,...patch},q)).toBeNull();
});
it('withholds missing or contradictory discrimination on the strict launch path',()=>{
 expect(discriminationIssue({approved:true},q,{requireDiscriminationAudit:true})).toBe('unverified_discriminator');
 expect(discriminationIssue({approved:true,discrimination:{...claim,alternativeAlsoCorrect:true}},q)).toBe('ambiguous_choices');
 expect(discriminationIssue({approved:true,discrimination:claim},q,{requireDiscriminationAudit:true})).toBeNull();
});
