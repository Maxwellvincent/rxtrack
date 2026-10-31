import {it,expect} from 'vitest';
import {buildQuestionAuditBaseline} from './questionAuditBaseline.js';
const q=(id,extra={})=>({id,stem:`A patient has a finding ${id}. Which structure is affected?`,choices:{A:'One',B:'Two'},correct:'A',...extra});
it('samples across lectures and source roles deterministically without mutating records',()=>{
 const input={generated:{a:{questions:Array.from({length:20},(_,i)=>q(`a${i}`))},b:{questions:[q('b1'),q('b2')]}},banks:{'Homework Week12.pdf':[q('h')],'ESoft.pdf':[q('e')],'IMCQ.pdf':[q('i')]},generatedLimit:4,now:0};
 const before=JSON.stringify(input),a=buildQuestionAuditBaseline(input),b=buildQuestionAuditBaseline(input);
 expect(a).toEqual(b);expect(JSON.stringify(input)).toBe(before);
 expect(a.sampled).toEqual({generated:4,homework:1,examsoft:1,imcq:1,clicker:0});
 expect(a.samples.filter(x=>x.lectureId==='b')).toHaveLength(2);
 expect(a.samples.every(x=>x.review.verdict===null)).toBe(true);
});
it('excludes contested and abbreviated original keys without hiding generated defects',()=>{
 const packet=buildQuestionAuditBaseline({generated:{a:{questions:[q('generated',{correct:null})]}},banks:{'homework.pdf':[q('ok'),q('held',{sourceKeyReviewStatus:'stem-mismatch'}),q('bad',{answerKeyVerified:false}),q('summary',{sourceRepresentation:'answer-explanation-summary'})]}});
 expect(packet.population).toMatchObject({generated:1,originals:4,eligibleOriginals:1,excludedOriginals:3});
 expect(packet.samples.find(x=>x.role==='generated').correct).toBeNull();
});
it('does not export account details, signed figure URLs, embedded images or answer history',()=>{
 const packet=buildQuestionAuditBaseline({generated:{a:{questions:[q('a',{userId:'private-account',sourceImageUrl:'https://private?token=secret',sourceImageDataUrl:'data:huge',answers:['private'],hasImage:true})]}}});
 const text=JSON.stringify(packet);expect(text).not.toContain('private-account');expect(text).not.toContain('token=secret');expect(text).not.toContain('data:huge');expect(packet.samples[0].figureRequired).toBe(true);
 expect(packet.limitations.join(' ')).toContain('not an unseen holdout');
});
it('supports empty retained stores without fabricating samples or order estimates',()=>{
 const packet=buildQuestionAuditBaseline();expect(packet.samples).toEqual([]);expect(packet.population.generated).toBe(0);
});

it('does not call a continuation-only original an eligible reference sample',()=>{
 const packet=buildQuestionAuditBaseline({banks:{'IMCQ.pdf':[q('fragment',{stem:'that is being ablated, which structure is involved?'}),q('complete')]}});
 expect(packet.population).toMatchObject({originals:2,eligibleOriginals:1,excludedOriginals:1});
 expect(packet.sampled.imcq).toBe(1);
});


it('includes in-class examples without inventing keys or claiming unseen exposure',()=>{
 const packet=buildQuestionAuditBaseline({banks:{'In Class Questions.pdf':[q('keyed'),q('unkeyed',{correct:null}),q('held',{sourceKeyReviewStatus:'stem-mismatch'})]}});
 expect(packet.version).toBe(4);
 expect(packet.sampled.clicker).toBe(2);
 const item=packet.samples.find(row=>row.originalId==='unkeyed');
 expect(item).toMatchObject({role:'clicker',correct:null,answerKeyAvailable:false,referenceUse:'construction-only',exposureToGeneration:'unknown'});
 expect(item.review.verdict).toBeNull();
 expect(packet.samples.some(row=>row.originalId==='held')).toBe(false);
});

it('exports only allowlisted review and template provenance metadata',()=>{
 const packet=buildQuestionAuditBaseline({generated:{a:{questions:[q('new',{qualityAudit:{reviewPolicy:'current',objectiveId:'o',objectiveAlignment:{objectiveClause:'Apply the supplied pathway'}},generationEvidence:{templateReferences:[{templateId:'t',sourceKind:'examsoft',sourceFile:'School.pdf',userId:'hidden-user',token:'hidden-token'}]}})]}}});
 expect(packet.samples[0]).toMatchObject({qualityReviewPolicy:'current',reviewedObjectiveId:'o',reviewedObjectiveClause:'Apply the supplied pathway'});
 expect(packet.samples[0].suppliedTemplateReferences[0].sourceKind).toBe('examsoft');
 expect(JSON.stringify(packet)).not.toContain('hidden-user');
 expect(JSON.stringify(packet)).not.toContain('hidden-token');
});

it('accounts for incomplete, unclassified and visual originals before sample filtering',()=>{
 const packet=buildQuestionAuditBaseline({banks:{'Classroom.pdf':[q('c',{sourceKind:'in-class',correct:null}),q('visual',{sourceKind:'in-class',stem:'An ECG is shown below. Which rate?'})],'Unknown.pdf':[{id:'empty'},q('badkey',{correct:'F'})]}});
 const rows=packet.sourceInventory;
 expect(rows.find(r=>r.sourceKind==='clicker')).toMatchObject({total:2,textTemplateEligible:1,constructionOnly:1,figureDependent:1,exclusionReasons:{requires_source_figure:1}});
 expect(rows.find(r=>r.sourceKind==='school')).toMatchObject({total:2,textTemplateEligible:0,exclusionReasons:{incomplete_item:1,missing_answer_key:1,key_not_in_choices:1}});
 expect(packet.provenanceCoverage.withTemplateReferences).toBe(0);
});

it('exports full objective clauses by stored scope without leaking unrelated objective fields',()=>{
 const objectives=[{id:'o',objective:'Compare pathways and predict lesion findings',blockId:'NB2',linkedLecId:'l',privateNotes:'do-not-export'},{id:'o',objective:'Other block content',blockId:'NB1',linkedLecId:'old'}];
 const packet=buildQuestionAuditBaseline({objectives,generated:{l:{questions:[q('linked',{objectiveIds:['o'],blockId:'NB2'})]}}});
 expect(packet.samples[0].objectiveText).toBe('Compare pathways and predict lesion findings');
 expect(packet.samples[0].objectiveLinks[0]).toMatchObject({status:'resolved',candidates:[{blockId:'NB2',lectureId:'l'}]});
 expect(JSON.stringify(packet)).not.toContain('do-not-export');
});
it('marks missing and conflicting objective IDs explicitly rather than guessing from topics',()=>{
 const packet=buildQuestionAuditBaseline({objectives:[{id:'same',text:'One clause',blockId:'a'},{id:'same',text:'Different clause',blockId:'b'}],generated:{unknown:{questions:[q('ambiguous',{objectiveIds:['same']}),q('missing',{objectiveIds:['missing']})]}}});
 expect(packet.samples.find(q=>q.originalId==='ambiguous').objectiveLinks[0].status).toBe('ambiguous');
 expect(packet.samples.find(q=>q.originalId==='missing').objectiveLinks[0].status).toBe('unresolved');
 expect(packet.samples.every(q=>q.objectiveText===null)).toBe(true);
});

it('does not resolve an explicit block link using another blocks matching ID',()=>{
 const packet=buildQuestionAuditBaseline({objectives:[{id:'o',text:'Other block clause',blockId:'old'}],generated:{l:{questions:[q('scoped',{objectiveIds:['o'],blockId:'new'})]}}});
 expect(packet.samples[0].objectiveLinks[0].status).toBe('unresolved');
});
