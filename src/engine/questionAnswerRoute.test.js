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
it('rejects paired neuron classifications as third order even when the reviewer lists multiple steps',()=>{
 const q={orderLevel:'third-order',stem:'Two motor neurons are tested experimentally. Which option correctly classifies these neurons?',choices:{A:'Neuron X is upper; neuron Y is lower',B:'Both are lower'}};
 expect(answerRouteIssue({kind:'connected-integration',outcomeRestatement:false,choiceShortcut:false,stemClue:'motor neurons are tested',requiredRelationship:'Upper neurons control lower neurons',whyNotRestatement:'Infer each identity from independent experimental observations'},q,{requireReasoningAudit:true})).toBe('insufficient_reasoning_depth');
});
it('does not credit parallel somatotopy coordinates as third-order integration',()=>{
 const item={orderLevel:'third-order',stem:'A focal lesion affects the anterior horn. Which region accounts for the deficit?',choices:{A:'Caudal, medial, dorsal region',B:'Rostral, lateral, dorsal region',C:'Rostral, lateral, ventral region'}};
 expect(answerRouteIssue(answerRoute(item.stem),item)).toBe('insufficient_reasoning_depth');
 expect(answerRouteIssue(answerRoute(item.stem),{...item,orderLevel:'second-order'})).toBeNull();
});

it('accepts a stem clue made of exact stem fragments joined by an ellipsis, but not paraphrase', () => {
 const question={orderLevel:'second-order',stem:'A 27-year-old woman comes to the physician because of a 2-week history of low mood, anhedonia, and fatigue. She reports that 3 months ago she had a 5-day period of elevated mood, increased energy, and decreased need for sleep, but she continued to function well at work and at home. Which of the following is the most likely diagnosis?'};
 const route=clue=>({kind:'relationship-application',outcomeRestatement:false,choiceShortcut:false,stemClue:clue,
  requiredRelationship:'Hypomania lasts at least 4 days without marked functional impairment.',whyNotRestatement:'The duration and preserved function must be applied to distinguish bipolar II from bipolar I.'});
 expect(answerRouteIssue(route('5-day period of elevated mood...continued to function well'),question,{requireReasoningAudit:true})).toBeNull();
 expect(answerRouteIssue(route('5-day period of elevated mood … continued to function well'),question,{requireReasoningAudit:true})).toBeNull();
 expect(answerRouteIssue(route('5-day period of elevated mood...kept working normally'),question,{requireReasoningAudit:true})).toBe('unverified_answer_route');
 expect(answerRouteIssue(route('5-day period...ab'),question,{requireReasoningAudit:true})).toBe('unverified_answer_route');
});
