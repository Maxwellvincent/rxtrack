import { describe,it,expect } from 'vitest';
import { alignSchoolQuestions,retrieveLectureEvidence,schoolEvidencePrompt } from './schoolAlignment.js';
import { selectStyleExemplars,buildMcqPrompt } from './mcq.js';
const objective={id:'o1',code:'SOM.MK.ER.PHYS.1076',text:'Granulosa aromatase converts androgen substrate into estrogen'};
const question={id:'q1',stem:'Which ovarian cells convert androgens?',choices:{A:'Granulosa cells',B:'Theca cells'},correct:'A',schoolObjectiveCode:objective.code,sourceFile:'IMCQ.pdf'};
describe('school evidence alignment',()=>{
 it('preserves source-code evidence separately from candidate word matches',()=>{
   const [linked]=alignSchoolQuestions([question],[objective]);
   expect(linked.links[0]).toMatchObject({basis:'school-code',targetId:'o1',evidence:[objective.code]});
   expect(alignSchoolQuestions([{...question,schoolObjectiveCode:null,stem:objective.text}],[objective])[0].links[0].basis).toBe('candidate-overlap');
 });
 it('does not claim alignment without evidence or accept an unverified key',()=>{
   expect(alignSchoolQuestions([question],[{id:'x',text:'cardiac preload'}])[0].links).toEqual([]);
   expect(alignSchoolQuestions([{...question,answerKeyVerified:false}],[objective])).toEqual([]);
   expect(schoolEvidencePrompt([],[],[])).toContain('No supported link');
 });
 it('prefers relevant source examples and retrieves evidence after the initial 4000 characters',()=>{
   const irrelevant={...question,id:'other',schoolObjectiveCode:'SOM.OTHER.1',stem:'Unrelated question'};
   expect(selectStyleExemplars([irrelevant,question],1,'medium',{objectives:[objective]})).toEqual([question]);
   const text='Introduction. '.repeat(500)+objective.text;
   expect(retrieveLectureEvidence(text,[objective],[],1000)).toContain('Granulosa');
   expect(buildMcqPrompt({lectureText:text,objectives:[objective],examples:[question]})).toContain('school-code');
 });
});
