import {it,expect} from 'vitest';
import {questionAdmissionIssues,QUESTION_CONTRACT_VERSION,QUESTION_CHOICE_CONTRACT} from './questionContract.js';
import {buildMcqPrompt,buildAtomQuestionsPrompt,buildQuestionAuditPrompt,buildRepairPrompt,normalizeQuestions} from './mcq.js';
it('shares the versioned source and choice contract across full, compact, atom, review and repair prompts',()=>{
 const cfg={lectureText:'A source fact.',atoms:[],objectives:[],count:1};
 for(const prompt of [buildMcqPrompt(cfg),buildMcqPrompt({...cfg,promptProfile:'compact'}),buildAtomQuestionsPrompt(cfg),buildQuestionAuditPrompt([],cfg),buildQuestionAuditPrompt([],{...cfg,promptProfile:'compact'}),buildRepairPrompt([],cfg)]){
  expect(prompt).toContain(QUESTION_CONTRACT_VERSION);expect(prompt).toContain(QUESTION_CHOICE_CONTRACT);
  expect(prompt).not.toContain('4-6 choices');expect(prompt).not.toContain('otherwise use five choices A-E');
 }
});
it('admits a complete fourteen-option pattern and rejects a merged or missing final option',()=>{
 const choices=Object.fromEntries(Array.from({length:14},(_,i)=>[String.fromCharCode(65+i),`Structure ${i}`]));
 const q={stem:'Which structure is involved?',choices,correct:'N',objectiveIds:['o']};
 expect(questionAdmissionIssues(q)).toEqual([]);
 const missing={...choices};delete missing.N;
 expect(questionAdmissionIssues({...q,choices:missing})).toContain('invalid_key_or_choices');
 const gap={...choices};delete gap.F;
 expect(questionAdmissionIssues({...q,choices:gap})).toContain('incomplete_choices');
});

it('preserves all source-supported choices through normalization beyond H',()=>{
 const choices=Object.fromEntries(Array.from({length:14},(_,i)=>[String.fromCharCode(65+i),`Structure ${i}`]));
 const [normalized]=normalizeQuestions([{stem:'Which structure carries the signal?',choices,correct:'N',explanation:'The final structure carries this signal.'}]);
 expect(Object.keys(normalized.choices)).toHaveLength(14);
 expect(normalized.choices[normalized.correct]).toBe('Structure 13');
});
