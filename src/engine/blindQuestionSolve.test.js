import {expect,it} from 'vitest';
import {buildBlindSolvePrompt,blindSolveIssue} from './blindQuestionSolve.js';
const source='Local responses persist after upstream input is interrupted. '.repeat(4);
const q={stem:'A response persists after upstream interruption. Which mechanism applies?',choices:{A:'Local mechanism',B:'Upstream mechanism'},correct:'A',explanation:'PRIVATE_WRITER_EXPLANATION',whyWrong:{B:'PRIVATE_WRITER_RATIONALE'},questionPlan:{inference:'PRIVATE_WRITER_PLAN'}};
const solved={answer:'A',unique:true,reasoning:{sourceQuotes:['Local responses persist after upstream input is interrupted.']}};
it('withholds the proposed key, rationales, plans and history from the solve request',()=>{
 const prompt=buildBlindSolvePrompt([q],{lectureText:source,focusNotes:'PRIVATE_HISTORY'});
 for(const secret of ['PRIVATE_WRITER_EXPLANATION','PRIVATE_WRITER_RATIONALE','PRIVATE_WRITER_PLAN','PRIVATE_HISTORY','"correct":'])expect(prompt).not.toContain(secret);
 expect(prompt).toContain(q.stem);expect(prompt).toContain('Local mechanism');
});
it('requires a unique matching solve and exact factual grounding without rekeying',()=>{
 expect(blindSolveIssue(solved,q,{lectureText:source})).toBeNull();
 expect(blindSolveIssue({...solved,answer:'B'},q,{lectureText:source})).toBe('blind_key_disagreement');
 expect(blindSolveIssue({...solved,unique:false},q,{lectureText:source})).toBe('unverified_blind_solution');
 expect(blindSolveIssue({...solved,reasoning:{sourceQuotes:['Invented quoted explanation.']}},q,{lectureText:source})).toBe('unverified_blind_solution');
 expect(q.correct).toBe('A');
});
