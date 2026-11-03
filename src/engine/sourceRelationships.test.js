import {answerRoute} from './testFixtures/answerRoute.js';
import {describe,it,expect} from 'vitest';
import {createSourceRelationship,mergeSourceRelationships,relationshipCoverage,relationshipTargets,bindReviewedRelationships} from './sourceRelationships.js';
import {QUESTION_REUSE_REVIEW_POLICY} from './questionReuse.js';
import {REASONING_REVIEW_POLICY} from './questionOrder.js';
const quote='The dorsal columns carry vibration and position signals ipsilaterally in the spinal cord.';
const objective={id:'o',linkedLecId:'lec',blockId:'b',objective:'Compare vibration pathways and their spinal laterality.'};
const pages=[{page:3,text:quote}];
const input={blockId:'b',lectureId:'lec',objective,clause:'vibration pathways',label:'Laterality',quote,page:3,pages};
const scope={blockId:'b',lectureId:'lec',objectives:[objective],pages};
const bundle=()=>createSourceRelationship(input);
const catalog=()=>mergeSourceRelationships({},[bundle()]);
describe('source-backed relationship identity',()=>{
 it('retains IDs across label edits and scopes them by objective and lecture',()=>{
  const first=bundle(),renamed=createSourceRelationship({...input,label:'Another label'});
  expect(first.relationship.id).toBe(renamed.relationship.id);
  expect(first.facet.id).toBe(renamed.facet.id);
  expect(createSourceRelationship({...input,objective:{...objective,id:'other'}}).relationship.id).not.toBe(first.relationship.id);
  expect(first.facet.inventoryComplete).toBe(false);
 });
 it.each([{clause:'A clause from another objective'},{page:2},{quote:'A plausible statement absent from this lecture page.'},{blockId:'other'}])('rejects unsupported source/parent placement %s',change=>{
  expect(()=>createSourceRelationship({...input,...change})).toThrow();
 });
 it('invalidates old-source rows without deleting them and versions relocated evidence',()=>{
  const original=catalog();
  expect(relationshipCoverage(original,{}, {...scope,pages:[{page:3,text:quote+' Updated source.'}]})).toEqual([]);
  const relocated=createSourceRelationship({...input,pages:[{page:4,text:quote}],page:4});
  const next=mergeSourceRelationships(original,[relocated]);
  expect(next.relationships[relocated.relationship.id].revision).toBe(2);
  expect(original.relationships[relocated.relationship.id].page).toBe(3);
 });
 it('requires an answered question with exact relationship ID, scope and source version',()=>{
  const registered=catalog(),row=bundle().relationship;
  const event={blockId:'b',lectureId:'lec',objectiveIds:['o'],questionKey:'q',correct:true,at:1,sourceRelationshipIds:[row.id],relationshipSourceVersion:row.sourceVersion};
  expect(relationshipCoverage(registered,{},scope)[0].attempts).toBe(0);
  expect(relationshipCoverage(registered,{learningJournal:[{...event,sourceRelationshipIds:[]}]},scope)[0].attempts).toBe(0);
  expect(relationshipCoverage(registered,{learningJournal:[{...event,lectureId:'other'}]},scope)[0].attempts).toBe(0);
  expect(relationshipCoverage(registered,{learningJournal:[event,{...event,at:2,correct:false}]},scope)[0]).toMatchObject({attempts:1,correct:0,lastCorrect:false});
 });
 it('does not schedule caption-only figure records as text targets',()=>{
  const record=createSourceRelationship({...input,kind:'figure'});
  expect(relationshipTargets(mergeSourceRelationships({},[record]),{},scope)).toEqual([]);
  expect(record.relationship.visualReviewRequired).toBe(true);
 });
 it('does not treat the existence of a relationship record as coverage',()=>{
  const rows=relationshipTargets(catalog(),{},scope);
  expect(rows[0]).toMatchObject({attempts:0,correct:0});
 });
});
const reviewed=()=>({stem:'A patient loses vibration sensation in the left leg. Which pathway is affected?',choices:{A:'Dorsal columns',B:'Other pathway'},correct:'A',objectiveIds:['o'],orderLevel:'second-order',generationVersion:'v2',
 reasoningAudit:{version:2,status:'verified',reviewPolicy:REASONING_REVIEW_POLICY,orderLevel:'second-order',sourceQuotes:[quote],connectedChain:true,singleEndpoint:true,choiceShortcut:false},
 qualityAudit:{status:'approved',reviewPolicy:QUESTION_REUSE_REVIEW_POLICY,reviewedAt:'2026-11-02T00:00:00Z',semanticObjectiveAlignment:true,objectiveId:'o',objectiveAlignment:{objectiveId:'o',objectiveClause:'vibration pathways'},blindSolve:{answerRoute:answerRoute('A patient loses vibration sensation in the left leg. Which pathway is affected?'),status:'matched',answer:'A',sourceQuotes:[quote]},discrimination:{closestAlternative:'B',stemClue:'loses vibration sensation',whyAlternativeFails:'The supplied modality follows a different pathway.',keyUniquelySupported:true,alternativeAlsoCorrect:false}}});
it('binds a currently reviewed question only to an explicit clause and original located source',()=>{
 const cfg={blockId:'b',lectureId:'lec',objectives:[objective],sourcePages:pages};
 expect(bindReviewedRelationships(reviewed(),cfg).sourceRelationshipIds).toEqual([bundle().relationship.id]);
 const unreviewed={...reviewed(),qualityAudit:{}};
 expect(bindReviewedRelationships(unreviewed,cfg)).not.toHaveProperty('sourceRelationshipIds');
 expect(bindReviewedRelationships(reviewed(),{...cfg,sourcePages:[{page:3,text:'Unrelated evidence'}]})).not.toHaveProperty('sourceRelationshipIds');
});

it('strips stale writer-assigned relationship credit before independent binding',()=>{
 const q={...reviewed(),sourceRelationshipIds:['invented'],objectiveFacetId:'invented',qualityAudit:{}};
 expect(bindReviewedRelationships(q,scope)).not.toHaveProperty('sourceRelationshipIds');
});
it('rejects catalog rows whose facet or current parent moved to another lecture',()=>{
 const c=catalog();c.facets[bundle().facet.id].lectureId='other';
 expect(relationshipCoverage(c,{},scope)).toEqual([]);
 expect(relationshipCoverage(catalog(),{},{...scope,objectives:[{...objective,linkedLecId:'other'}]})).toEqual([]);
});
it('uses the latest answer chronologically after repeated-question updates',()=>{
 const row=bundle().relationship;
 const event={blockId:'b',lectureId:'lec',objectiveIds:['o'],correct:true,sourceRelationshipIds:[row.id],relationshipSourceVersion:row.sourceVersion};
 expect(relationshipCoverage(catalog(),{learningJournal:[{...event,questionKey:'q1',at:1},{...event,questionKey:'q2',at:2},{...event,questionKey:'q1',at:3,correct:false}]},scope)[0]).toMatchObject({attempts:2,lastAt:3,lastCorrect:false});
});
it('schedules only current-source due relationships and leaves same-day successes cooling down',()=>{
 const c=catalog(),row=bundle().relationship,day=24*60*60*1000;
 const event={blockId:'b',lectureId:'lec',objectiveIds:['o'],questionKey:'q',correct:true,sessionKey:'s1',at:100,sourceRelationshipIds:[row.id],relationshipSourceVersion:row.sourceVersion};
 expect(relationshipTargets(c,{learningJournal:[event]},scope,3,200)).toEqual([]);
 expect(relationshipTargets(c,{learningJournal:[event]},scope,3,day+100)[0]).toMatchObject({practiceState:'due',previousQuestionKeys:['q']});
 expect(relationshipTargets(c,{learningJournal:[{...event,correct:false}]},scope,3,200)[0].practiceState).toBe('repair');
 expect(relationshipTargets(c,{learningJournal:[],evidenceJournal:[event]},scope,3,200)[0].practiceState).toBe('unseen');
});
