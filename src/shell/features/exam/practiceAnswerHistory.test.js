import {it,expect} from 'vitest';
import {practiceAnswerHistory} from './practiceAnswerHistory.js';
import {questionProgress} from './questionProgress.js';
import {evidenceIdentity} from '../../../engine/questionScoringPolicy.js';
it('restores older quiz answers missing from calibration and counts mirrored writes only once',()=>{
 const event={source:'quiz',blockId:'b',lectureId:'l',questionKey:evidenceIdentity('q'),sessionKey:'s',at:100,correct:true};
 const result=practiceAnswerHistory([{ts:130,concept:'Q',questionKey:'q',sessionKey:'s',correct:true}],{evidenceJournal:[event,{...event,questionKey:'older',at:50,correct:false}]},'b',['l']);
 expect(questionProgress(result.studyAnswers)).toMatchObject({answered:2,correct:1});
});
it('preserves later retakes even when an old session key was reused',()=>{
 const event={source:'quiz',blockId:'b',questionKey:'q',sessionKey:'same',at:100,correct:true};
 const result=practiceAnswerHistory([],{evidenceJournal:[event,{...event,at:900000,correct:false}]},'b');
 expect(questionProgress(result.studyAnswers)).toMatchObject({answered:2,correct:1});
});
it('does not double-count school journal entries on top of saved sessions or borrow other blocks',()=>{
 const event={source:'quiz',blockId:'other',questionKey:'q',at:100,correct:true};
 expect(practiceAnswerHistory([],{evidenceJournal:[event,{...event,blockId:'b',source:'school-practice'}]},'b').studyAnswers).toHaveLength(0);
});
it('includes a scoped historical baseline only in lifetime totals, never today',()=>{
 const history=practiceAnswerHistory([],{evidenceBaseline:{lectures:{l:{attempts:61,correct:45},other:{attempts:100,correct:100}}}},'b',['l']);
 expect(questionProgress([],[],{},[],history.historicalStudy)).toMatchObject({answered:61,correct:45});
 expect(questionProgress([],[],{startAt:1,endAt:100},[],history.historicalStudy).answered).toBe(0);
});
it('excludes reported performance errors but keeps objective-link-only reports in question volume',()=>{
 const event={source:'quiz',blockId:'b',questionKey:'q',at:100,correct:true};
 expect(practiceAnswerHistory([],{evidenceJournal:[event]},'b',[],{r:{sourceIssue:'incorrect-key',evidenceKey:evidenceIdentity('q')}}).studyAnswers).toHaveLength(0);
 expect(practiceAnswerHistory([],{evidenceJournal:[event]},'b',[],{r:{sourceIssue:'source-mismatch',evidenceKey:evidenceIdentity('q')}}).studyAnswers).toHaveLength(1);
});
it('subtracts traceable pre-baseline answers from the legacy aggregate rather than adding them twice',()=>{
 const history=practiceAnswerHistory([{ts:20,lectureId:'l',concept:'Early',correct:true}],{evidenceBaseline:{updatedAt:30,lectures:{l:{attempts:3,correct:2}}}},'b',['l']);
 expect(questionProgress(history.studyAnswers,[],{},[],history.historicalStudy)).toMatchObject({answered:3,correct:2});
});
