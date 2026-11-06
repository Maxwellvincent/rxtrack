import {it,expect,vi} from 'vitest';
import {buildBlindSourceReviewPrompt,decodeBlindSourceReviews} from './blindSourceReview.js';
import {auditGeneratedQuestions} from './mcq.js';
const quote='Local responses persist after the upstream input is blocked.';
const q={stem:'A patient has weakness after upstream input is blocked. A local response persists despite this interruption. Which mechanism explains the preserved response?',choices:{A:'Local response mechanism',B:'Upstream input mechanism',C:'Absent response',D:'Unrelated response'},correct:'A',explanation:'PRIVATE_WRITER_EXPLANATION',objectiveIds:['o1'],orderLevel:'second-order'};
const cfg={requireBlindKeyCheck:true,requireReasoningAudit:true,requireDiscriminationAudit:true,lectureText:quote.repeat(4),objectives:[{id:'o1',objective:'Explain preservation of local responses after upstream input is interrupted'}]};
const proof=()=>({index:0,answer:'A',unique:true,approved:true,objectiveAligned:true,issues:[],objectiveAlignment:{objectiveId:'o1',objectiveClause:cfg.objectives[0].objective,testedRelationship:quote,bestSourceObjectiveCode:'',whyAssignedOverNeighbor:'The task asks why the local response persists.'},discrimination:{closestAlternative:'B',stemClue:'A local response persists despite this interruption',whyAlternativeFails:'Upstream-only drive would disappear when upstream input is blocked.',keyUniquelySupported:true,alternativeAlsoCorrect:false},reasoning:{orderLevel:'second-order',steps:['Interpret the preserved response after interruption','Apply the independence of the local response'],sourceQuotes:[quote],allStepsRequired:true,connectedChain:true,singleEndpoint:true,choiceShortcut:false},answerRoute:{kind:'relationship-application',stemClue:'A local response persists despite this interruption',requiredRelationship:quote,whyNotRestatement:'The observed persistence must be related to the interrupted upstream input.',outcomeRestatement:false,choiceShortcut:false},explanation:'The preserved response after upstream interruption indicates a local response mechanism.',whyWrong:{B:'An upstream-dependent response would cease.',C:'An absent response contradicts the observed persistence.',D:'An unrelated response does not explain the supplied local mechanism.'}});
it('withholds every writer answer, explanation and plan from the independent source reviewer',()=>{
 const prompt=buildBlindSourceReviewPrompt([{...q,questionPlan:{relationship:'PRIVATE_WRITER_PLAN'}}],cfg);
 expect(prompt).not.toContain('PRIVATE_WRITER_EXPLANATION');expect(prompt).not.toContain('PRIVATE_WRITER_PLAN');expect(prompt).not.toContain('"correct":');
});
it('uses one independent call and the existing admission gates, replacing unreviewed writer rationales',async()=>{
 const call=vi.fn().mockResolvedValue({reviews:[proof()]});
 const result=await auditGeneratedQuestions([q],cfg,{blindSourceReview:true,reviewAIJSON:call,skipRepair:true});
 expect(call).toHaveBeenCalledTimes(1);expect(result.questions).toHaveLength(1);
 expect(result.questions[0].explanation).not.toContain('PRIVATE_WRITER');
 expect(result.questions[0].qualityAudit).toMatchObject({reviewMode:'independent-blind-source',blindSolve:{status:'matched',answer:'A'}});
 expect(result.questions[0].reasoningAudit.status).toBe('verified');expect(result.questions[0].questionPlan.provenance).toBe('independent-review');
});
it.each(['key','source','reasoning','rationale'])('does not admit a %s failure through the combined path',async kind=>{
 const review=proof();if(kind==='key')review.answer='B';if(kind==='source')review.reasoning.sourceQuotes=['A fabricated source statement.'];if(kind==='reasoning')review.reasoning.allStepsRequired=false;if(kind==='rationale')review.whyWrong={};
 const result=await auditGeneratedQuestions([q],cfg,{blindSourceReview:true,reviewAIJSON:vi.fn().mockResolvedValue({reviews:[review]}),skipRepair:true});
 expect(result.questions).toEqual([]);
});
it('never supplies missing booleans when expanding compact independent source verdicts',()=>{
 const v=decodeBlindSourceReviews({reviews:[{i:0,k:'A',a:true}]}).reviews[0];expect(v.unique).toBeUndefined();expect(v.reasoning.allStepsRequired).toBeUndefined();expect(v.answerRoute.outcomeRestatement).toBeUndefined();
});
it('expands selected objective references from the supplied source without inventing missing judgments',()=>{
 const raw={i:0,k:'A',a:true,al:true,x:[],o:['o1','SOM.01','This task tests preserved local responses.'],rule:quote,link:'The preserved output identifies an independent local mechanism.',d:proof().discrimination,r:['second-order',['Interpret preserved local output','Apply independence from upstream input'],['E1'],true,true,true,false],route:'relationship-application',restated:false,w:proof().whyWrong};
 const expanded=decodeBlindSourceReviews({reviews:[raw]},cfg).reviews[0];
 expect(expanded.objectiveAlignment).toMatchObject({objectiveId:'o1',objectiveClause:cfg.objectives[0].objective,testedRelationship:quote,bestSourceObjectiveCode:'SOM.01'});
 expect(expanded.explanation).toContain(raw.link);expect(expanded.answerRoute.requiredRelationship).toBe(quote);
 expect(decodeBlindSourceReviews({reviews:[{...raw,o:['unknown','SOM.01','unknown']}]},cfg).reviews[0].objectiveAlignment.objectiveClause).toBeUndefined();
});
it('keeps each independent key proof attached to its own choice ordering when duplicate stems are removed',async()=>{
 const second={...q,choices:{...q.choices,A:q.choices.B,B:q.choices.A},correct:'B'};
 const p2={...proof(),index:1,answer:'B',discrimination:{...proof().discrimination,closestAlternative:'A'},whyWrong:{...proof().whyWrong,A:'An upstream-dependent response would cease.'}};
 delete p2.whyWrong.B;
 const result=await auditGeneratedQuestions([q,second],cfg,{blindSourceReview:true,reviewAIJSON:vi.fn().mockResolvedValue({reviews:[proof(),p2]}),skipRepair:true,reviewBatchSize:3});
 expect(result.questions.length).toBeGreaterThan(0);
 for(const accepted of result.questions)expect(accepted.qualityAudit.blindSolve.answer).toBe(accepted.correct);
});
it('expands compact alternative checks without defaulting missing verdicts',()=>{
 const rows=decodeBlindSourceReviews({reviews:[{i:0,d:['F','exact source clue','Competing prediction contradicts this observation.',true,false]},{i:1,d:['B','another exact clue']}]}).reviews;
 expect(rows[0].discrimination).toEqual({closestAlternative:'F',stemClue:'exact source clue',whyAlternativeFails:'Competing prediction contradicts this observation.',keyUniquelySupported:true,alternativeAlsoCorrect:false});
 expect(rows[1].unique).toBeUndefined();expect(rows[1].discrimination.alternativeAlsoCorrect).toBeUndefined();
});
