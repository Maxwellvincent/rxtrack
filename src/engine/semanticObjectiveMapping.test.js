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

it('keeps every explicitly named homework lecture ahead of unrelated lexical matches',()=>{
 const local=[...Array.from({length:4},(_,i)=>({id:`noise${i}`,blockId:'NB',lectureNumber:i+1,lectureTitle:'Cricothyroid recurrent laryngeal nerve',chunks:[{text:quote}]})),...Array.from({length:4},(_,i)=>({id:`source${i}`,blockId:'NB',lectureNumber:28+i,lectureTitle:`NB ${28+i} Assigned lecture`,chunks:[{text:quote}]}))];
 const targets=local.map(l=>({...objectives[0],id:`o-${l.id}`,linkedLecId:l.id}));
 const context=objectiveMappingContext({...question,sourceLectureNumbers:[28,29,30,31]},local,targets,'NB');
 expect(context.candidates.map(c=>c.lectureId)).toEqual(['source0','source1','source2','source3']);
});
it('retains lecture evidence even when no catalog objective is linked yet',()=>{
 expect(objectiveMappingContext(question,lectures,[],'NB').candidates[0]).toMatchObject({lectureId:'l',objectives:[]});
});
it('retrieves the named sleep section ahead of drug or generic clinical vocabulary',()=>{
 const noise=Array.from({length:8},(_,i)=>({id:`noise-${i}`,blockId:'NB',lectureTitle:'Substance use delirium dementia',fullText:'A medication changes clinical symptoms. Decreases stage effects. '.repeat(8)}));
 const sleep={id:'sleep',blockId:'NB',lectureTitle:'NB 62 Sleep-Wake Disorders',fullText:'Parasomnias include somnambulism. The original teaching passage describes the sleep mechanism being tested.'};
 const context=objectiveMappingContext({sourceSectionTitle:'Sleep-Wake Disorders',sourceFile:'Week 15 NB BEHS Practice Questions',stem:'What is the mechanism of the medication?',choices:{A:'Decreases stage N3 sleep'},correct:'A'},[...noise,sleep],[],'NB');
 expect(context.candidates[0].lectureId).toBe('sleep');expect(context.candidates[0].retrieval.sectionMatch).toBe(true);
});
it('includes DLA teaching evidence and objectives instead of discarding it as a supplementary resource',()=>{
 const dla={id:'dla',blockId:'NB',lectureType:'DLA',lectureTitle:'NB DLA 17 Gender Dysphoria, Sexual Dysfunctions & Paraphilias',fullText:'The lecture explicitly teaches the treatment relationship for the sexual dysfunction tested by the source case.'};
 const context=objectiveMappingContext({sourceSectionTitle:'Sexual Dysfunctions',stem:'A patient needs treatment.',choices:{A:'A medication'},correct:'A'},[...lectures,dla],[{id:'dla-o',linkedLecId:'dla',objective:'Explain treatment of sexual dysfunctions'}],'NB');
 expect(context.candidates[0].lectureId).toBe('dla');expect(context.candidates[0].objectives[0].id).toBe('dla-o');
});
it('expands original evidence before saving an unresolved mapping and records its actual search scope',async()=>{
 const long={...lectures[0],fullText:('Background content. '.repeat(600))+quote,chunks:[]};
 const evaluation=vi.fn();const review=vi.fn().mockResolvedValue({decision:'unresolved',reason:'The requested relationship was not established.'});
 await classifyObjectiveMapping(question,{lectures:[long],objectives,blockId:'NB',review,onEvaluation:evaluation});
 expect(review).toHaveBeenCalledTimes(2);expect(evaluation.mock.calls[0][0]).toMatchObject({retrieval:{expanded:true,scopeLectures:1,sourceIndexed:1},candidates:[{lectureId:'l'}]});
});
it('can retain verified background evidence without crediting its secondary objective',async()=>{
 const supporting='Cricothyroid is explicitly identified as belonging to the muscle class needed by the tested example.';
 const background={id:'background',blockId:'NB',lectureTitle:'Other pharmacology',fullText:supporting};
 const valid={...proposal,supportingEvidence:[{lectureId:'background',sourceQuote:supporting,relationship:'Background class identity only'}]};
 const mapped=await classifyObjectiveMapping(question,{lectures:[...lectures,background],objectives,blockId:'NB',review:vi.fn().mockResolvedValue(valid)});
 expect(mapped.objectiveIds).toEqual(['o']);expect(mapped.curriculumMapping.supportingEvidence).toHaveLength(1);
 expect(validateObjectiveMapping({...valid,supportingEvidence:[{lectureId:'background',sourceQuote:'Invented background text with no original lecture evidence.'}]},objectiveMappingContext(question,[...lectures,background],objectives,'NB'))).toBeNull();
});
it('shows the whole curriculum directory and honors a source request beyond the initial shortlist',async()=>{
 const local=Array.from({length:14},(_,i)=>({id:`l${i}`,blockId:'NB',lectureTitle:`Teaching topic ${i}`,fullText:i===13?quote:'Generic clinical question context repeated '+i}));
 const target={...objectives[0],id:'requested',linkedLecId:'l13'};
 const q={stem:'Generic clinical question context',choices:{A:'A finding'},correct:'A'};
 const first=objectiveMappingContext(q,local,[target],'NB');expect(first.directory).toHaveLength(14);expect(first.candidates.some(c=>c.lectureId==='l13')).toBe(false);
 const accepted={decision:'objective',links:[{...proposal.links[0],lectureId:'l13',objectiveId:'requested'}]};
 const review=vi.fn().mockResolvedValueOnce({decision:'unresolved',requestedLectureIds:['l13']}).mockResolvedValue(accepted);
 const mapped=await classifyObjectiveMapping(q,{lectures:local,objectives:[target],blockId:'NB',review});expect(mapped?.lectureId).toBe('l13');expect(review).toHaveBeenCalledTimes(3);
});

it('links an integrated question to one objective in each of two lectures when each quote comes from its own lecture',async()=>{
 const fear='The ventromedial prefrontal cortex down-regulates amygdala firing during formation of extinction memory.';
 const vessel='The anterior cerebral artery supplies the medial and orbital surfaces of the frontal lobe including prefrontal cortex.';
 const lecs=[{id:'nb55',blockId:'NB',lectureTitle:'NB 55 Emotions',chunks:[{text:fear}]},{id:'nb40',blockId:'NB',lectureTitle:'NB 40 Cerebral Blood Supply',chunks:[{text:vessel}]}];
 const objs=[{id:'o55',blockId:'NB',linkedLecId:'nb55',objective:'Understand fear and extinction learning circuitry'},{id:'o40',blockId:'NB',linkedLecId:'nb40',objective:'Describe the territories of the cerebral arteries'}];
 const q={stem:'After an ischemic stroke, a previously extinguished fear of flying returns. Occlusion of which artery best explains this?',choices:{A:'Anterior cerebral artery',B:'Posterior cerebral artery'},correct:'A',sourceSectionTitle:'NB 55 Emotions'};
 const links=[{objectiveId:'o55',objectiveText:objs[0].objective,lectureId:'nb55',sourceQuote:fear,testedRelationship:'vmPFC loss releases amygdala from extinction memory'},
  {objectiveId:'o40',objectiveText:objs[1].objective,lectureId:'nb40',sourceQuote:vessel,testedRelationship:'ACA territory includes the prefrontal cortex'}];
 const review=vi.fn().mockResolvedValue({decision:'objective',links});
 const result=await classifyObjectiveMapping(q,{lectures:lecs,objectives:objs,blockId:'NB',review});
 expect(result.lectureId).toBe('nb55');
 expect(result.objectiveIds).toEqual(['o55','o40']);
 expect(result.secondaryLectureIds).toEqual(['nb40']);
 expect(result.curriculumMapping.crossLecture).toBe(true);
 const context=objectiveMappingContext({...q,mappingQuery:'anterior cerebral artery prefrontal'},lecs,objs,'NB',{expanded:true,requestedLectureIds:['nb55','nb40']});
 expect(validateObjectiveMapping({decision:'objective',links:[links[0],{...links[1],sourceQuote:fear}]},context)).toBeNull();
});

it('shows the reviewer the learner precedents and retrieves their lectures, without treating them as evidence',async()=>{
 const sleep='Stage 2 sleep is characterized by sleep spindles and K-complexes on the EEG.';
 const lecs=[{id:'nb61',blockId:'NB',lectureTitle:'NB 61 Sleep',chunks:[{text:sleep}]},{id:'nb60',blockId:'NB',lectureTitle:'NB 60 Biological Rhythms',chunks:[{text:'Circadian rhythms are entrained by light.'}]}];
 const objs=[{id:'o61',blockId:'NB',linkedLecId:'nb61',objective:'Contrast sleep stages through the use of electroencephalography'}];
 const q={stem:'An EEG shows spindles. Which stage?',choices:{A:'NREM stage 2'},correct:'A'};
 const precedents=[{stem:'Polysomnography shows K complexes. Which stage?',lectureId:'nb61',lectureLabel:'NB 61 Sleep',objectiveIds:['o61'],sameHeading:true}];
 const review=vi.fn().mockResolvedValue({decision:'objective',links:[{objectiveId:'o61',objectiveText:objs[0].objective,lectureId:'nb61',sourceQuote:sleep,testedRelationship:'Stage 2 EEG features identify the stage'}]});
 const result=await classifyObjectiveMapping(q,{lectures:lecs,objectives:objs,blockId:'NB',review,precedents});
 const sent=JSON.parse(review.mock.calls[0][1]);
 expect(sent.learnerPrecedents).toEqual(precedents);
 expect(sent.candidates.some(c=>c.lectureId==='nb61')).toBe(true);
 expect(review.mock.calls[0][0]).toMatch(/learner-confirmed precedents/i);
 expect(result.objectiveIds).toEqual(['o61']);
});
