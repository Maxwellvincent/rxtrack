import { expect, it } from 'vitest';
import { blueprintSourceGroup, mapSourceQuestion, buildBlueprintSourceCoverage } from './blueprintSourceCoverage.js';
const objectivesByLecture={a:[{id:'a1',code:'SOM.BPM2.ANAT.1',linkedLecId:'a'}],n:[{id:'n1',code:'SOM.BPM2.NSCI.1',linkedLecId:'n'}],mixed:[{id:'m1',discipline:'ANAT'},{id:'m2',discipline:'HCB'}]};
const lectures=[{id:'a',blockId:'b',lectureTitle:'Anatomy'},{id:'n',blockId:'b',lectureTitle:'Neuroscience'},{id:'mixed',blockId:'b',lectureTitle:'Mixed disciplines'}];
const q=(id,code,extra={})=>({id,stem:`Which structure is identified in clinical case ${id}?`,choices:{A:'First structure',B:'Second structure'},correct:'A',schoolObjectiveCode:code,...extra});
const context={objectivesByLecture,lectures,blockId:'b'};
it('recognizes homework, ESoft, and IMCQ files without using their names to assign subjects',()=>{
 expect(blueprintSourceGroup({filename:'Week 10 Practice Quesxtions.pdf',sourceKind:'homework'})).toBe('homework');
 expect(blueprintSourceGroup({filename:'NB ESOFT 2 Answer Explanations.pdf'})).toBe('examsoft');
 expect(blueprintSourceGroup({filename:'NB IMCQs.pdf'})).toBe('imcq');
 expect(mapSourceQuestion(q('x',null),context).status).toBe('unmapped');
});
it('uses school objective codes rather than clinical topic wording',()=>{
 expect(mapSourceQuestion(q('x','SOM.BPM2.ANAT.1',{subject:'Neuroscience'}),context)).toMatchObject({subject:'anatomy',basis:'objective-code',objectiveIds:['a1']});
 expect(mapSourceQuestion(q('x','SOM.BPM1.ANAT.1'),context).status).toBe('outside-course');
});
it('does not promote candidate IDs or infer a particular objective from a lecture',()=>{
 expect(mapSourceQuestion(q('x',null,{candidateObjectiveLinks:[{targetId:'a1'}],objectiveIds:['a1']}),context).status).toBe('unmapped');
 const mapped=mapSourceQuestion(q('y',null,{lectureId:'a',curriculumLinkStatus:'user-confirmed'}),context);
 expect(mapped).toMatchObject({subject:'anatomy',basis:'single-discipline-lecture'});
 expect(mapped.objectiveIds).toBeUndefined();
 expect(mapSourceQuestion(q('z',null,{lectureId:'mixed',curriculumLinkStatus:'user-confirmed'}),context).status).toBe('mixed');
});
it('compares source mixes, deduplicates pooled questions, and retains unusable-item counts',()=>{
 const a=q('a','SOM.BPM2.ANAT.1'),n=q('n','SOM.BPM2.NSCI.1'),missing=q('h','SOM.BPM2.HCB.1',{stem:'A photomicrograph is shown below. Which layer is identified?'});
 const banks=[{filename:'Homework.pdf',blockId:'b',questions:[a,n,missing]},{filename:'NB ESOFT.pdf',blockId:'b',questions:[{...a,id:'copy'},q('unknown',null)]}];
 const before=JSON.stringify(banks);
 const report=buildBlueprintSourceCoverage({exam:3,banks,...context});
 expect(report).toMatchObject({total:4,rawQuestions:5,mapped:3,unmapped:1,missingFigures:1,unusable:1});
 expect(report.rows.map(r=>r.questions)).toEqual([1,1,1]);
 expect(report.rows[0].observedShare).toBeCloseTo(100/3);
 expect(report.rows.find(r=>r.subject==='histology').usable).toBe(0);
 expect(report.groups.find(g=>g.key==='examsoft')).toMatchObject({total:2,mapped:1});
 expect(JSON.stringify(banks)).toBe(before);
});
it('holds conflicting mappings unresolved and does not let duplicate upload order choose a subject',()=>{
 const a=q('same','SOM.BPM2.ANAT.1'),n={...a,schoolObjectiveCode:'SOM.BPM2.NSCI.1'};
 const banks=[{filename:'Homework.pdf',questions:[a]},{filename:'ESoft.pdf',questions:[n]}];
 for(const ordered of [banks,[...banks].reverse()])expect(buildBlueprintSourceCoverage({banks:ordered,...context})).toMatchObject({total:1,mapped:0,mixed:1});
});
it('explicit other courses and unresolved questions do not dilute observed mapped percentages',()=>{
 const report=buildBlueprintSourceCoverage({banks:[{filename:'IMCQ.pdf',questions:[q('a','SOM.BPM2.ANAT.1'),q('b','SOM.BMP1.NSCI.1'),q('c',null)]}],...context});
 expect(report).toMatchObject({outsideCourse:1,unmapped:1,mapped:1});
 expect(report.rows[0].observedShare).toBe(100);
});
it('a usable cropped repeat restores availability without double-counting the question',()=>{
 const missing=q('h','SOM.BPM2.HCB.1',{stem:'The histology image shown below identifies which tissue?'});
 const report=buildBlueprintSourceCoverage({banks:[{filename:'Homework.pdf',questions:[missing]},{filename:'IMCQ.pdf',questions:[{...missing,sourceImageUrl:'https://example.com/crop.jpg'}]}],...context});
 expect(report).toMatchObject({total:1,missingFigures:0,unusable:0});
 expect(report.rows.find(r=>r.subject==='histology').usable).toBe(1);
});
