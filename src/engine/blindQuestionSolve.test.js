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

it('does not offer extracted notes as blind-solve citations when original lecture evidence is required',()=>{
 const note='EXTRACTED_ONLY_NOTE: this paraphrase is absent from the original lecture.';
 const prompt=buildBlindSolvePrompt([q],{lectureText:source,atoms:[{term:'Note',content:note}]});
 expect(prompt).not.toContain(note);expect(prompt).not.toContain('extracted-fact');expect(prompt).toContain('Local responses persist');
});
it('retains extracted-fact evidence when no original lecture is supplied',()=>{
 const note='Local responses persist after upstream input is interrupted.';
 const prompt=buildBlindSolvePrompt([q],{atoms:[{term:'Local response',content:note}]});
 expect(prompt).toContain(note);expect(prompt).toContain('extracted-fact');
});
it('independently distinguishes dependent integration from one-rule application without receiving writer routes',()=>{
 const prompt=buildBlindSolvePrompt([{...q,orderLevel:'third-order'}],{lectureText:source,writerIntegrationPlans:[{intermediate:'PRIVATE_INTERMEDIATE'}]});
 expect(prompt).toContain('two dependent taught relationships');
 expect(prompt).toContain('Two parallel lookups do not qualify');
 expect(prompt).not.toContain('PRIVATE_INTERMEDIATE');
 const route={kind:'connected-integration',stemClue:'persists after upstream interruption',requiredRelationship:'A local generator persists and then drives the downstream response.',whyNotRestatement:'Both dependent rules are needed to infer the downstream response.',outcomeRestatement:false,choiceShortcut:false};
 expect(blindSolveIssue({...solved,answerRoute:route},{...q,orderLevel:'third-order'},{lectureText:source})).toBeNull();
 expect(blindSolveIssue({...solved,answerRoute:{...route,kind:'relationship-application'}},{...q,orderLevel:'third-order'},{lectureText:source})).toBe('insufficient_reasoning_depth');
});
it('rejects the live cortical-to-body shortcut even when the solver claims a longer cerebellar chain',()=>{
 const question={...q,stem:'A patient has a right precentral gyrus lesion. Which side of the body would have received coordination support from this cortical copy?',choices:{A:'Left side of the body',B:'Right side of the body'},orderLevel:'third-order'};
 const route={kind:'connected-integration',stemClue:'right precentral gyrus lesion',requiredRelationship:'Trace the ipsilateral pontine relay and then the crossed cerebellar input.',whyNotRestatement:'A proposed cerebellar route has two necessary links.',outcomeRestatement:false,choiceShortcut:false};
 expect(blindSolveIssue({...solved,answerRoute:route},question,{lectureText:source})).toBe('insufficient_reasoning_depth');
 expect(blindSolveIssue({...solved,answerRoute:{...route,stemClue:'right precentral gyrus lesion'}},{...question,stem:'A patient has a right precentral gyrus lesion. Which cerebellar hemisphere receives the indirect input?',choices:{A:'Left cerebellar hemisphere',B:'Right cerebellar hemisphere'}},{lectureText:source})).toBeNull();
});
