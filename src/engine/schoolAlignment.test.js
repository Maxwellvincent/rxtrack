import { describe,it,expect } from 'vitest';
import { alignSchoolQuestions,retrieveLectureEvidence,schoolEvidencePrompt } from './schoolAlignment.js';
import { selectStyleExemplars,buildMcqPrompt } from './mcq.js';
const objective={id:'o1',code:'SOM.MK.ER.PHYS.1076',text:'Granulosa aromatase converts androgen substrate into estrogen'};
const question={id:'q1',stem:'Which ovarian cells convert androgens?',choices:{A:'Granulosa cells',B:'Theca cells'},correct:'A',schoolObjectiveCode:objective.code,sourceFile:'ExamSoftPractice.pdf'};
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

it("keeps repeated objective slides from displacing the explanatory lecture evidence", () => {
  const index = "Lecture objectives\nSOM.MK.001 Describe CSF.\nSOM.MK.002 Describe hydrocephalus.\nSOM.MK.003 Describe communicating hydrocephalus.";
  const source = [...Array(10).fill(index), "Communicating hydrocephalus can arise from impaired absorption of CSF through arachnoid villi. A tracer injected into a lateral ventricle appears in lumbar CSF."].join("\f");
  const evidence = retrieveLectureEvidence(source, [{ objective: "Describe communicating hydrocephalus" }]);
  expect(evidence).toContain("impaired absorption");
  expect(evidence).not.toContain("SOM.MK.001");
});

it("preserves explanatory text when the extraction has no page separators", () => {
  const index = "SOM.MK.001 Describe CSF. SOM.MK.002 Describe hydrocephalus. SOM.MK.003 Describe ICP. ";
  const source = index.repeat(15) + "Communicating hydrocephalus arises from impaired absorption of CSF through the arachnoid villi. ".repeat(15);
  expect(retrieveLectureEvidence(source, [{ objective: "Describe communicating hydrocephalus" }])).toContain("impaired absorption");
});

 it('pins verified draft evidence but never promotes fabricated draft quotes to source',()=>{
   const quote='Gap junctions permit direct ion flow between adjacent cells.';
   const source=quote+' '+('Aromatase androgen estrogen. '.repeat(500));
   const result=retrieveLectureEvidence(source,[objective],[{term:'aromatase',content:'estrogen',sourceQuotes:[quote,'Fabricated lecture evidence about dopamine']}],1600);
   expect(result).toContain(quote);
   expect(result).not.toContain('Fabricated lecture evidence about dopamine');
   expect(result.length).toBeLessThanOrEqual(1600);
 });
