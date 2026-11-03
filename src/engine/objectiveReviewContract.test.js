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
it('allows one correction of missing ownership evidence and still rejects a genuine mismatch',async()=>{
 const question={stem:'A sustained stimulus initially evokes rapid firing. The response declines over time despite unchanged stimulation. Which property explains this observation?',choices:{A:'Receptor adaptation',B:'Increased axonal conduction',C:'Motor recruitment',D:'Increased stimulus intensity'},correct:'A',explanation:'Adaptation reduces the response to continued stimulation.',objectiveIds:['o'],orderLevel:'second-order'};
 const reasoning={orderLevel:'second-order',steps:['Interpret declining firing despite sustained input','Apply receptor adaptation to explain reduced response'],sourceQuotes:[quote],allStepsRequired:true,connectedChain:true,singleEndpoint:true,choiceShortcut:false};
 const claim={objectiveId:'o',objectiveClause:'receptor adaptation and its sensory consequences',testedRelationship:'Apply adaptation to declining firing',bestSourceObjectiveCode:objective.code,whyAssignedOverNeighbor:'The task tests adaptation, not fiber conduction.'};
 const first={index:0,approved:true,objectiveAligned:true,issues:[],reasoning,objectiveAlignment:{objectiveId:'o',objectiveClause:claim.objectiveClause,testedRelationship:claim.testedRelationship}};
 const discrimination={closestAlternative:'B',stemClue:'declines over time despite unchanged stimulation',whyAlternativeFails:'The observation concerns a changing response to sustained input, not transmission speed.',keyUniquelySupported:true,alternativeAlsoCorrect:false};
 const review=vi.fn().mockResolvedValueOnce({reviews:[{...first,discrimination}]}).mockResolvedValueOnce({reviews:[{...first,discrimination,objectiveAlignment:claim}]});
 const cfg={lectureText,objectives:[objective],promptProfile:'compact',requireReasoningAudit:true,requireDiscriminationAudit:true};
 const result=await auditGeneratedQuestions([question],cfg,{reviewAIJSON:review,skipRepair:true});
 expect(review).toHaveBeenCalledTimes(2);expect(result.questions).toHaveLength(1);
 const mismatch=vi.fn().mockResolvedValue({reviews:[{...first,objectiveAligned:false,discrimination,issues:['objective_mismatch']}]});
 const rejected=await auditGeneratedQuestions([question],cfg,{reviewAIJSON:mismatch,skipRepair:true});
 expect(mismatch).toHaveBeenCalledTimes(1);expect(rejected.questions).toEqual([]);
});
