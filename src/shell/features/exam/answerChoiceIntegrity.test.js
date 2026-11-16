import {expect,it,vi} from 'vitest';
import {normalizeQuestions} from '../../../engine/mcq.js';
import {orderedChoiceEntries} from './choiceOrder.js';
import {mergeAnswer} from '../../../examSessions.js';
import {scoreAnsweredQuestions} from './questionBankLinks.js';
it('preserves the correct answer text through choice shuffling, save, reload and grading',()=>{
 const original={stem:'The supplied rule names Alpha. Which named structure does the rule identify?',choices:{A:'Alpha',B:'Beta',C:'Gamma',D:'Delta'},correct:'A',explanation:'The rule identifies Alpha.',whyWrong:{A:'Alpha matches the supplied rule.',B:'Beta does not match.',C:'Gamma does not match.',D:'Delta does not match.'}};
 const random=vi.spyOn(Math,'random');
 try{
  for(const value of [0,0.2,0.5,0.9]){
   random.mockReturnValue(value);
   const [shuffled]=normalizeQuestions({questions:[original]});
   expect(shuffled).toBeDefined();
   expect(shuffled.choices[shuffled.correct]).toBe('Alpha');
   expect(shuffled.whyWrong[shuffled.correct]).toContain('Alpha');
   const question={...shuffled,questionId:'q'};
   const saved=JSON.parse(JSON.stringify({questions:[question],answers:mergeAnswer([],{questionId:'q',value:question.correct,seq:1,answeredAt:100,writerId:'w'})}));
   saved.questions[0].choices=Object.fromEntries(Object.entries(saved.questions[0].choices).reverse());
   const displayed=Object.fromEntries(orderedChoiceEntries(saved.questions[0].choices));
   expect(displayed[saved.answers[0].value]).toBe('Alpha');
   expect(scoreAnsweredQuestions(saved)).toMatchObject({correct:1,incorrect:0,accuracy:100});
  }
 }finally{random.mockRestore();}
});
