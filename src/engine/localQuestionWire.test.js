import {it,expect} from 'vitest';
import {decodeLocalQuestionWire} from './localQuestionWire.js';
it('expands compact questions without changing source content, keys or extended choices',()=>{
 const choices={A:'First',B:'Second',F:'Sixth',N:'Fourteenth'};
 const raw={questions:[{s:'Which source relationship explains the finding?',c:choices,k:'N',e:'Exact explanation',w:{A:'Contradiction'},o:['o1'],t:'Circuit',f:'Application',l:'third-order',u:'clinical-application',r:['One','Two','Three'],h:'hard',p:['Rule','Change','Infer','Ask','Alternative','Clue',['Exact source quote']]}]};
 const q=decodeLocalQuestionWire(raw).questions[0];
 expect(q).toMatchObject({stem:raw.questions[0].s,choices,correct:'N',orderLevel:'third-order',objectiveIds:['o1'],questionPlan:{relationship:'Rule',sourceQuotes:['Exact source quote']}});
 expect(raw.questions[0]).not.toHaveProperty('stem');
});
it('expands every independent review verdict explicitly and never fills missing approval evidence',()=>{
 const complete={i:2,a:true,al:true,x:[],o:['o1','Exact clause','Relation','SOM.01','Distinct from neighbor'],d:['B','Exact clue','Positive contradiction',true,false],r:['second-order',['Interpret','Apply'],['E2'],true,true,true,false]};
 expect(decodeLocalQuestionWire({reviews:[complete]}).reviews[0]).toMatchObject({index:2,approved:true,objectiveAligned:true,objectiveAlignment:{objectiveId:'o1',bestSourceObjectiveCode:'SOM.01'},discrimination:{keyUniquelySupported:true,alternativeAlsoCorrect:false},reasoning:{evidenceIds:['E2'],allStepsRequired:true,choiceShortcut:false}});
 const missing=decodeLocalQuestionWire({reviews:[{i:0,a:true}]}).reviews[0];
 expect(missing.objectiveAligned).toBeUndefined();expect(missing.reasoning.allStepsRequired).toBeUndefined();expect(missing.discrimination.keyUniquelySupported).toBeUndefined();
});
it('keeps the blind solve independent and preserves explicit uncertainty',()=>{
 const v=decodeLocalQuestionWire({reviews:[{i:0,k:null,a:false,b:['relationship-application','Clue','Rule','Inference',false,false],z:['E1']}]}).reviews[0];
 expect(v).toMatchObject({answer:null,unique:false,answerRoute:{outcomeRestatement:false,choiceShortcut:false},reasoning:{evidenceIds:['E1']}});
 expect(v).not.toHaveProperty('approved');
});
it('supports existing full-format questions and reviews unchanged',()=>{
 const q={stem:'Original',choices:{A:'One',B:'Two'},correct:'A'},r={index:0,approved:false,issues:['ambiguous_choices']};
 const decoded=decodeLocalQuestionWire({questions:[q],reviews:[r]});expect(decoded.questions[0]).toBe(q);expect(decoded.reviews[0]).toBe(r);
});
