import {describe,it,expect} from 'vitest';
import {prepareLectureQuestionContext,preparedLectureCatalog} from './lectureQuestionContext.js';
import {buildLocalMcqPrompt,buildLocalAuditPrompt} from './localQuestionPrompts.js';
import {buildBlindSolvePrompt} from './blindQuestionSolve.js';
const cfg={lectureText:'Local responses persist after upstream input is interrupted.\fDamage to the local circuit abolishes its coordinated output.',objectives:[{id:'o',objective:'Explain local circuit function'}]};
describe('shared lecture question context',()=>{
 it('reuses one exact evidence prefix across writing and independent reviews without leaking proposed answers',()=>{
  const context=prepareLectureQuestionContext(cfg);const scoped={...cfg,promptProfile:'local',lectureQuestionContext:context};
  const q={stem:'Which circuit explains preserved local output?',choices:{A:'Local circuit',B:'Upstream input'},correct:'A',explanation:'PRIVATE_WRITER_RATIONALE'};
  const writer=buildLocalMcqPrompt({...scoped,count:3});const audit=buildLocalAuditPrompt([q],scoped);const blind=buildBlindSolvePrompt([q],scoped);
  for(const prompt of [writer,audit,blind])expect(prompt.startsWith(context.catalog)).toBe(true);
  expect(blind).not.toContain('PRIVATE_WRITER_RATIONALE');expect(blind).not.toContain('"correct":');
  expect(context.catalog).not.toContain('PRIVATE_WRITER_RATIONALE');
 });
 it('refuses a cached catalog from different source text',()=>{
  const context=prepareLectureQuestionContext(cfg);expect(preparedLectureCatalog({...cfg,lectureQuestionContext:context,lectureText:'Different lecture.'})).toBeNull();
 });
});
