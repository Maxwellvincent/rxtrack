import {it,expect} from 'vitest';
import {answerRouteIssue,ANSWER_ROUTE_CONTRACT} from './questionAnswerRoute.js';
import {answerRoute} from './testFixtures/answerRoute.js';
const q={stem:'Two stimulation sites are 0.40 m apart with an onset latency difference of 4.0 ms. What is conduction velocity?',orderLevel:'second-order'};
it('keeps a valid taught-rule calculation and causal application eligible',()=>{
 expect(answerRouteIssue(answerRoute(q.stem,{kind:'calculation',requiredRelationship:'Conduction velocity equals intersite distance divided by the latency difference.'}),q)).toBeNull();
 expect(answerRouteIssue(answerRoute(q.stem,{kind:'relationship-application'}),q)).toBeNull();
 expect(ANSWER_ROUTE_CONTRACT).toContain('Preserve valid calculations');
});
it('rejects outcome renaming and choice shortcuts even with a correct unique answer',()=>{
 for(const route of [answerRoute(q.stem,{kind:'outcome-restatement'}),answerRoute(q.stem,{outcomeRestatement:true}),answerRoute(q.stem,{choiceShortcut:true}),answerRoute(q.stem,{kind:'definition'})])expect(answerRouteIssue(route,q)).toBe('answer_choice_shortcut');
});
it('requires explicit route evidence and a clue from the actual stem',()=>{
 for(const route of [undefined,answerRoute('An invented observation not in this stem'),answerRoute(q.stem,{requiredRelationship:''}),answerRoute(q.stem,{whyNotRestatement:''}),answerRoute(q.stem,{outcomeRestatement:undefined})])expect(answerRouteIssue(route,q)).toBe('unverified_answer_route');
});
it('does not count one numerical rule as third-order or ban honestly labeled recall',()=>{
 expect(answerRouteIssue(answerRoute(q.stem,{kind:'calculation'}),{...q,orderLevel:'third-order'})).toBe('insufficient_reasoning_depth');
 expect(answerRouteIssue(answerRoute(q.stem),{...q,orderLevel:'third-order'})).toBeNull();
 expect(answerRouteIssue(undefined,{...q,orderLevel:'first-order'},{requireReasoningAudit:true})).toBeNull();
});
