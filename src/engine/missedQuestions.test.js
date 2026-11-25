import {describe,it,expect} from 'vitest';
import {missedQuestionGroups} from './missedQuestions.js';
import {conceptName} from './conceptIdentity.js';
const event=(id,topic,at,correct=false,extra={})=>({questionKey:id,lectureId:'l',blockId:'b',at,correct,source:'homework',learningContext:{stem:id,choices:{A:'Projection',B:'Displacement'},correctLetter:'A',topic},...extra});
describe('combined missed question history',()=>{
 it('groups synonymous concepts within lectures across sources and clears original items independently',()=>{
  const journal=[event('1','attributing own unwanted trait to another',1),event('2','attributing own infidelity to another',2,false,{source:'ExamSoft'}),event('3','Projection',3,false,{lectureId:'other'}),event('1','Projection',4,true)];
  const groups=missedQuestionGroups({learningJournal:journal},{blockId:'b'});
  expect(groups).toHaveLength(2);
  expect(groups[0]).toMatchObject({concept:'Projection',lectureId:'l',sources:['ExamSoft']});
  expect(groups[0].questions).toHaveLength(1);
 });
 it('does not clear misses with assisted success or invent absent original questions',()=>{
  const groups=missedQuestionGroups({learningJournal:[event('1','Projection',1),{questionKey:'old',correct:false}],assistedJournal:[event('1','Projection',2,true,{assisted:true})]});
  expect(groups.flatMap(g=>g.questions)).toHaveLength(1);
 });
 it('keeps different defense mechanisms distinct',()=>{
  expect(conceptName('channeling negative emotions into constructive activity')).toBe('Sublimation');
  expect(conceptName('displacement toward substitute targets')).toBe('Displacement');
 });
});
describe('clearing a miss with a correct redo',()=>{
 it('clears the original miss when the correct answer kept only the compact question identity',async()=>{
  const {schoolQuestionIdentity}=await import('../shell/features/exam/schoolSourceIdentity.js');
  const {missContextForAnswer}=await import('./learningLoop.js');
  const question={stem:'A 24-year-old woman is bitten by a dog while jogging and now avoids parks.',choices:{A:'Specific phobia',B:'PTSD'},correct:'B',topic:'Trauma'};
  const miss={questionKey:'e_old',lectureId:'l',blockId:'b',at:1,correct:false,source:'quiz',learningContext:missContextForAnswer(question,'A',false)};
  const redo={questionKey:'e_replay',lectureId:'l',blockId:'b',at:2,correct:true,source:'quiz',learningContext:missContextForAnswer(question,'B',true)};
  expect(redo.learningContext.stem).toBeUndefined();
  expect(redo.learningContext.identity).toBe(schoolQuestionIdentity({stem:question.stem,choices:question.choices,correct:'B'}));
  expect(missedQuestionGroups({learningJournal:[miss]},{blockId:'b'}).flatMap(g=>g.questions)).toHaveLength(1);
  expect(missedQuestionGroups({learningJournal:[miss,redo]},{blockId:'b'}).flatMap(g=>g.questions)).toHaveLength(0);
 });
});
describe('marking a miss as learned',()=>{
 it('hides a miss marked learned after it happened, and a newer miss brings it back',()=>{
  const first=missedQuestionGroups({learningJournal:[event('1','Projection',5)]});
  const id=first[0].questions[0].questionId;
  expect(missedQuestionGroups({learningJournal:[event('1','Projection',5)]},{dismissed:{ids:{[id]:6}}})).toHaveLength(0);
  expect(missedQuestionGroups({learningJournal:[event('1','Projection',5),event('1','Projection',7)]},{dismissed:{ids:{[id]:6}}})).toHaveLength(1);
 });
});
