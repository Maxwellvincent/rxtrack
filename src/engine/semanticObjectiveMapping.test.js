import {it,expect,vi} from 'vitest';
import {classifyObjectiveMapping,objectiveMappingContext,validateObjectiveMapping} from './semanticObjectiveMapping.js';
const quote='The recurrent laryngeal nerve supplies the intrinsic laryngeal muscles except the cricothyroid muscle.';
const lectures=[{id:'l',blockId:'NB',termId:'T2',lectureTitle:'Pharynx and Larynx',chunks:[{text:quote}]}];
const objectives=[{id:'o',blockId:'NB',linkedLecId:'l',objective:'Explain the motor innervation of the larynx'}];
const question={lectureId:'l',stem:'Which muscle is spared after recurrent laryngeal nerve injury?',choices:{A:'Cricothyroid'},correct:'A'};
const proposal={decision:'objective',links:[{objectiveId:'o',lectureId:'l',sourceQuote:quote,testedRelationship:'Motor innervation of intrinsic laryngeal muscles'}]};
it('requires two agreeing semantic reviews and preserves quote provenance',async()=>{
 const review=vi.fn().mockResolvedValue(proposal);
 const result=await classifyObjectiveMapping(question,{lectures,objectives,blockId:'NB',review});
 expect(review).toHaveBeenCalledTimes(2);expect(result.objectiveIds).toEqual(['o']);expect(result.curriculumMapping.links[0].sourceQuote).toBe(quote);
 expect(result.curriculumMapping.crossBlockCredit).toBe(false);
});
it('rejects foreign IDs, invented quotations, duplicate links and disagreement',async()=>{
 const context=objectiveMappingContext(question,lectures,objectives,'NB');
 for(const bad of [{...proposal.links[0],objectiveId:'foreign'},{...proposal.links[0],sourceQuote:'An invented sentence about nerve injuries and muscles.'}])expect(validateObjectiveMapping({...proposal,links:[bad]},context)).toBeNull();
 expect(validateObjectiveMapping({...proposal,links:[proposal.links[0],proposal.links[0]]},context)).toBeNull();
 const review=vi.fn().mockResolvedValueOnce(proposal).mockResolvedValueOnce({decision:'unresolved'});
 expect(await classifyObjectiveMapping(question,{lectures,objectives,blockId:'NB',review})).toBeNull();
});
it('does not borrow evidence from another block or supplementary resource',()=>{
 expect(objectiveMappingContext(question,lectures.map(l=>({...l,blockId:'ER'})),objectives,'NB').candidates).toEqual([]);
 expect(objectiveMappingContext(question,lectures.map(l=>({...l,lectureType:'SG'})),objectives,'NB').candidates).toEqual([]);
});
