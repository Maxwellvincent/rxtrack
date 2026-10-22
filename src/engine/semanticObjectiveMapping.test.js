import {it,expect,vi} from 'vitest';
import {classifyObjectiveMapping,objectiveMappingContext,validateObjectiveMapping} from './semanticObjectiveMapping.js';
const quote='The recurrent laryngeal nerve supplies the intrinsic laryngeal muscles except the cricothyroid muscle.';
const lectures=[{id:'l',blockId:'NB',termId:'T2',lectureTitle:'Pharynx and Larynx',chunks:[{text:quote}]}];
const objectives=[{id:'o',blockId:'NB',linkedLecId:'l',objective:'Explain the motor innervation of the larynx'}];
const question={lectureId:'l',stem:'Which muscle is spared after recurrent laryngeal nerve injury?',choices:{A:'Cricothyroid'},correct:'A'};
const proposal={decision:'objective',links:[{objectiveId:'o',objectiveText:objectives[0].objective,lectureId:'l',sourceQuote:quote,testedRelationship:'Motor innervation of intrinsic laryngeal muscles'}]};
it('requires two agreeing semantic reviews and preserves quote provenance',async()=>{
 const review=vi.fn().mockResolvedValue(proposal);
 const result=await classifyObjectiveMapping(question,{lectures,objectives,blockId:'NB',review});
 expect(review).toHaveBeenCalledTimes(2);expect(result.objectiveIds).toEqual(['o']);expect(result.curriculumMapping.links[0].sourceQuote).toBe(quote);
 expect(result.curriculumMapping.crossBlockCredit).toBe(false);
});
it('rejects foreign IDs, invented quotations, duplicate links and disagreement',async()=>{
 const context=objectiveMappingContext(question,lectures,objectives,'NB');
 for(const bad of [{...proposal.links[0],objectiveId:'foreign'},{...proposal.links[0],objectiveText:'An unrelated objective about axonal transection'},{...proposal.links[0],sourceQuote:'An invented sentence about nerve injuries and muscles.'}])expect(validateObjectiveMapping({...proposal,links:[bad]},context)).toBeNull();
 expect(validateObjectiveMapping({...proposal,links:[proposal.links[0],proposal.links[0]]},context)).toBeNull();
 const review=vi.fn().mockResolvedValueOnce(proposal).mockResolvedValueOnce({decision:'unresolved'});
 expect(await classifyObjectiveMapping(question,{lectures,objectives,blockId:'NB',review})).toBeNull();
});
it('does not borrow evidence from another block or supplementary resource',()=>{
 expect(objectiveMappingContext(question,lectures.map(l=>({...l,blockId:'ER'})),objectives,'NB').candidates).toEqual([]);
 expect(objectiveMappingContext(question,lectures.map(l=>({...l,lectureType:'SG'})),objectives,'NB').candidates).toEqual([]);
});

it('retrieves the keyed glial-cell relationship despite long unrelated lecture sections',async()=>{
 const {mappingLectureExcerpt}=await import('./semanticObjectiveMapping.js');
 const source=('Neurons transmit impulses. Soma and dendrites receive input. '.repeat(400))+' Astrocytes: key functions include maintaining the blood-brain barrier and regulating extracellular potassium. '+('Oligodendrocytes provide myelin in the CNS. '.repeat(300));
 const excerpt=mappingLectureExcerpt(source,{stem:'Which glial cell contributes to the blood-brain barrier?',choices:{A:'Astrocytes',B:'Oligodendrocytes'},correct:'A'});
 expect(excerpt).toContain('Astrocytes: key functions include maintaining the blood-brain barrier');
 expect(excerpt.length).toBeLessThanOrEqual(2800);
});

it('ranks the clinical teaching context ahead of an old general lecture assignment',()=>{
 const source='The eye has a corneal reflex and adduction is mediated by the medial rectus and oculomotor nerve. These nerves traverse the superior orbital fissure.';
 const local=[{id:'general',blockId:'NB',weekNumber:8,lectureTitle:'Skull Foramina',chunks:[{text:'The superior orbital fissure transmits several nerves.'}]},{id:'eye',blockId:'NB',weekNumber:10,lectureTitle:'Eye Anatomy',chunks:[{text:source}]}];
 const targets=local.map(l=>({id:`obj-${l.id}`,blockId:'NB',linkedLecId:l.id,objective:'Explain nerve pathways'}));
 const context=objectiveMappingContext({lectureId:'general',sourceFile:'Week 10 Homework.pdf',sourceSectionTitle:'Eye Anatomy',stem:'Double vision with inability to adduct the eye and loss of the corneal reflex.',correct:'A',choices:{A:'Superior orbital fissure'}},local,targets,'NB');
 expect(context.candidates[0].lectureId).toBe('eye');
 expect(context.question.sourceContext.weekNumber).toBe(10);
 expect(context.candidates[0].weekNumber).toBe(10);
});
