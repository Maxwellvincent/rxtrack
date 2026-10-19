import { it, expect } from 'vitest';
import { reportProtection, protectSessionScoring } from './questionScoringPolicy.js';
it('scores 15 correct out of 18 eligible answers while preserving all 20 attempts', () => {
 const session = { questions: Array.from({length:20}, (_,i)=>({ questionId:`q${i}`, correct:'A' })), answers: Array.from({length:20},(_,i)=>({ questionId:`q${i}`, value:i<15?'A':'B' })) };
 const ratings = { r1:{evidenceKey:'q18',sourceIssue:'invalid-choices'},r2:{evidenceKey:'q19',sourceIssue:'incorrect-key'} };
 const scored = protectSessionScoring(session,ratings);
 expect(scored.answers).toHaveLength(18);
 expect(scored.answers.filter(a=>a.value==='A')).toHaveLength(15);
 expect(scored.originalAnswers).toHaveLength(20);
 expect(session.answers).toHaveLength(20);
 expect(protectSessionScoring(session,{})).toBe(session);
});
it('keeps incomplete explanations scored and limits source mismatches to objective credit', () => {
 expect(reportProtection({sourceIssue:'incomplete-explanation'})).toEqual({performance:false,objective:false});
 const session={questions:[{questionId:'q',objectiveIds:['o']}],answers:[{questionId:'q',value:'A'}]};
 const scored=protectSessionScoring(session,{r:{evidenceKey:'q',sourceIssue:'source-mismatch'}});
 expect(scored.answers).toHaveLength(1);expect(scored.questions[0].objectiveIds).toEqual([]);
 expect(session.questions[0].objectiveIds).toEqual(['o']);
});
it('allows explicit score retention while protecting objective evidence', () => {
 expect(reportProtection({sourceIssue:'incorrect-key',excludeFromPerformance:false})).toEqual({performance:false,objective:true});
});

it('protects missing visual attempts while retaining the raw answers', () => {
 const session={questions:[{questionId:'missing',stem:'Imaging shows a hematoma (see attached). Which diagnosis?'},{questionId:'complete',stem:'Site X to Site Y. Which direction?',sourceImageUrl:'https://example.com/crop.jpg'}],answers:[{questionId:'missing',value:'A'},{questionId:'complete',value:'B'}]};
 const scored=protectSessionScoring(session);
 expect(scored.answers.map(a=>a.questionId)).toEqual(['complete']);
 expect(scored.originalAnswers).toHaveLength(2);
 expect(scored.scoringExcludedQuestionIds).toEqual(['missing']);
});
