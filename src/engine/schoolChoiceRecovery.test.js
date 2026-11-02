import {it,expect} from 'vitest';
import {cleanSchoolQuestion,normalizeSessionSchoolChoices} from './schoolSourceText.js';
it('recovers printed N from M in an existing session without changing the key or pick',()=>{
 const choices=Object.fromEntries('ABCDEFGHIJKL'.split('').map(l=>[l,`Option ${l}`]));choices.M='Left pons N. Left medulla';
 const session={sourceType:'question-bank',questions:[{questionId:'q',choices,correct:'H'}],answers:[{questionId:'q',value:'H'}]};
 const fixed=normalizeSessionSchoolChoices(session);
 expect(fixed.questions[0].choices.M).toBe('Left pons');expect(fixed.questions[0].choices.N).toBe('Left medulla');
 expect(fixed.questions[0].correct).toBe('H');expect(fixed.answers).toBe(session.answers);expect(session.questions[0].choices.M).toBe('Left pons N. Left medulla');
});
it('does not add unprinted options or split a non-sequential label',()=>{
 const q={choices:{A:'An explanation with N. in its text',B:'Normal response'}};
 expect(cleanSchoolQuestion(q)).toBe(q);
});
