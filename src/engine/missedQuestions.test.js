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
