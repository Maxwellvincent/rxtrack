import {it,expect,vi} from 'vitest';
import {buildQuestionAuditPrompt,auditGeneratedQuestions} from './mcq.js';
const objective={id:'o',code:'SOM.MK.I.BPM2.1.NB.1.NSCI.0114',objective:'Describe receptor adaptation and its sensory consequences'};
const quote='Receptors adapt to sustained stimulation and reduce their firing rate over time.';
const lectureText=`Learning Objectives\n${objective.code} ${objective.objective}\nSOM.MK.I.BPM2.1.NB.1.NSCI.0115 Classify fibers by conduction velocity and diameter\f${quote.repeat(4)}`;
it('supplies neighboring ownership instructions and every required field in both review formats',()=>{
 for(const promptProfile of ['compact','full']){
  const prompt=buildQuestionAuditPrompt([],{objectives:[objective],lectureText,promptProfile});
  expect(prompt).toContain('NEIGHBORING SOURCE OBJECTIVES');expect(prompt).toContain('NSCI.0115');
  expect(prompt).toContain('"bestSourceObjectiveCode":"exact strongest source code"');
  expect(prompt).toContain('"whyAssignedOverNeighbor":"specific ownership distinction"');
 }
});
it.each([1,3])('allows one correction of missing ownership evidence and still rejects a genuine mismatch (review batch %i)',async(reviewBatchSize)=>{
 const question={stem:'A sustained stimulus initially evokes rapid firing. The response declines over time despite unchanged stimulation. Which property explains this observation?',choices:{A:'Receptor adaptation',B:'Increased axonal conduction',C:'Motor recruitment',D:'Increased stimulus intensity'},correct:'A',explanation:'Adaptation reduces the response to continued stimulation.',objectiveIds:['o'],orderLevel:'second-order'};
 const reasoning={orderLevel:'second-order',steps:['Interpret declining firing despite sustained input','Apply receptor adaptation to explain reduced response'],sourceQuotes:[quote],allStepsRequired:true,connectedChain:true,singleEndpoint:true,choiceShortcut:false};
 const claim={objectiveId:'o',objectiveClause:'receptor adaptation and its sensory consequences',testedRelationship:'Apply adaptation to declining firing',bestSourceObjectiveCode:objective.code,whyAssignedOverNeighbor:'The task tests adaptation, not fiber conduction.'};
 const first={index:0,approved:true,objectiveAligned:true,issues:[],reasoning,objectiveAlignment:{objectiveId:'o',objectiveClause:claim.objectiveClause,testedRelationship:claim.testedRelationship}};
 const discrimination={closestAlternative:'B',stemClue:'declines over time despite unchanged stimulation',whyAlternativeFails:'The observation concerns a changing response to sustained input, not transmission speed.',keyUniquelySupported:true,alternativeAlsoCorrect:false};
 const review=vi.fn().mockResolvedValueOnce({reviews:[{...first,discrimination}]}).mockResolvedValueOnce({reviews:[{...first,discrimination,objectiveAlignment:claim}]});
 const cfg={lectureText,objectives:[objective],promptProfile:'compact',requireReasoningAudit:true,requireDiscriminationAudit:true};
 const batch=reviewBatchSize>1?[question,{...question,stem:"A repeated stimulus is maintained. The response declines over time despite unchanged stimulation. Which property explains this observation?"}]:[question];
 if(reviewBatchSize>1){review.mockReset().mockResolvedValueOnce({reviews:batch.map((_,index)=>({...first,discrimination,index}))}).mockResolvedValueOnce({reviews:batch.map((_,index)=>({...first,discrimination,objectiveAlignment:claim,index}))});}
 const result=await auditGeneratedQuestions(batch,cfg,{reviewAIJSON:review,reviewBatchSize,skipRepair:true});
 expect(review).toHaveBeenCalledTimes(2);expect(result.questions).toHaveLength(1);
 expect(result.rejections?.flatMap(row=>row.issues) || []).not.toContain("unverified_objective_alignment");
 if(reviewBatchSize>1){
  const interrupted=vi.fn().mockResolvedValueOnce({reviews:[{...first,discrimination,objectiveAlignment:claim,index:0},{...first,discrimination,index:1}]}).mockRejectedValueOnce(new Error('Provider timed out'));
  const partial=await auditGeneratedQuestions(batch,cfg,{reviewAIJSON:interrupted,reviewBatchSize,skipRepair:true});
  expect(partial.questions).toHaveLength(1);expect(partial.failureKind).toBe('review_unavailable');expect(partial.error).toContain('timed out');
 }
 const mismatch=vi.fn().mockResolvedValue({reviews:[{...first,objectiveAligned:false,discrimination,issues:['objective_mismatch']}]});
 const rejected=await auditGeneratedQuestions([question],cfg,{reviewAIJSON:mismatch,skipRepair:true});
 expect(mismatch).toHaveBeenCalledTimes(1);expect(rejected.questions).toEqual([]);
});
