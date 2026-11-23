import {it,expect} from 'vitest';
import {thirdOrderConstructionPrompt,integrationConnectionTargets} from './thirdOrderConstruction.js';
import {buildMcqPrompt} from './mcq.js';
const objective={id:'o',objective:'Contrast lower versus upper motor neurons.',_targetOrder:'third-order'};
const primary={id:'r1',objectiveId:'o',kind:'text',quote:'The first lecture rule connects A to B.',learning:{prerequisiteIds:['r2']}};
const support={id:'r2',objectiveId:'o',kind:'text',quote:'The second lecture rule connects B to C.',practiceState:'waiting'};
it('keeps saved prerequisite support available for integration even when its retest is not due',()=>{
 expect(integrationConnectionTargets([primary],[primary,support,{...support,id:'foreign',objectiveId:'other'},{...support,id:'figure',kind:'figure'}],[objective],1).map(row=>row.id)).toEqual(['r1','r2']);
 expect(integrationConnectionTargets([primary],[primary,support],[{...objective,_targetOrder:'second-order'}],1)).toEqual([primary]);
});
it('requires a shared hidden intermediate and a source-backed two-rule deletion test without changing lower-level prompts',()=>{
 const prompt=thirdOrderConstructionPrompt({objectives:[objective],relationshipTargets:[primary,support]});
 expect(prompt).toContain('SAME hidden intermediate');expect(prompt).toContain('removing either rule');expect(prompt).toContain(primary.quote);expect(prompt).toContain(support.quote);
 expect(thirdOrderConstructionPrompt({objectives:[{...objective,_targetOrder:'second-order'}]})).toBe('');
});
it.each([{promptProfile:'compact'},{promptProfile:'local'},{promptProfile:'full'},{blindSourceReview:true}])('supplies the construction contract on every writer route %s',profile=>{
 const prompt=buildMcqPrompt({...profile,objectives:[objective],lectureText:('The first rule connects A to B. The second connects B to C. ').repeat(8),relationshipTargets:[primary,support],count:1,reasoningPolicy:'challenge'});
 expect(prompt).toContain('THIRD-ORDER CONSTRUCTION');expect(prompt).toContain('TWO exact sourceQuotes');
});
it('rejects a fabricated or disconnected route without granting the writer verification credit',async()=>{
 const {validateIntegrationPlans}=await import('./thirdOrderConstruction.js');
 const plan={objectiveId:'o',firstRule:{from:'Cortex',to:'Pontine relay',quote:primary.quote},secondRule:{from:'Pontine relay',to:'Cerebellum',quote:support.quote},observation:'Selective cortical input is interrupted.',endpoint:'Cerebellar input side',whyBothRequired:'Both the ipsilateral relay and the crossing rule are needed.'};
 const cfg={objectives:[objective],lectureText:primary.quote+' '+support.quote};
 expect(validateIntegrationPlans({plans:[plan]},cfg)).toHaveLength(1);
 expect(validateIntegrationPlans({plans:[{...plan,secondRule:{...plan.secondRule,from:'Unrelated node'}}]},cfg)).toEqual([]);
 expect(validateIntegrationPlans({plans:[{...plan,firstRule:{...plan.firstRule,quote:'A fabricated source sentence that does not occur in the lecture.'}}]},cfg)).toEqual([]);
});
it('calibrates two-rule integration consistently without loosening independent source or shortcut checks',async()=>{
 const {thirdOrderReviewPrompt}=await import('./thirdOrderConstruction.js');
 const prompt=thirdOrderReviewPrompt({requestedThirdOrder:true});
 expect(prompt).toContain('Do NOT demand THREE relationships');
 expect(prompt).toContain('Reject if either rule can be removed');
 expect(prompt).toContain('unique key and distractors independently');
 expect(thirdOrderReviewPrompt({objectives:[{...objective,_targetOrder:'second-order'}]})).toBe('');
});
it('does not count a rule supplied in the question as a hidden inference',async()=>{
 const {thirdOrderReviewPrompt}=await import('./thirdOrderConstruction.js');
 expect(thirdOrderConstructionPrompt({objectives:[objective]})).toContain('Do not teach rule 1 in the stem');
 expect(thirdOrderReviewPrompt({requestedThirdOrder:true})).toContain('GIVEN DATA, not a learner inference');
});
it('aliases objective IDs safely and keeps planning untrusted and source-bound',async()=>{
 const {planThirdOrderQuestions}=await import('./thirdOrderConstruction.js');
 let sent;
 const call=async(system,prompt,_fallback,_tokens,_provider,_temp,options)=>{sent={system,prompt,options};return {plans:[{objectiveId:'O1',firstRule:{from:'Cortex',to:'Pontine relay',quote:primary.quote},secondRule:{from:'Pontine relay',to:'Cerebellum',quote:support.quote},observation:'Selective cortical input is interrupted.',endpoint:'Cerebellar input side',whyBothRequired:'Both the ipsilateral relay and the crossing rule are needed.'}]};};
 const plans=await planThirdOrderQuestions({objectives:[objective],lectureText:primary.quote+' '+support.quote},call);
 expect(plans[0].objectiveId).toBe('o');expect(plans[0]).not.toHaveProperty('approved');
 expect(sent.prompt).toContain('Never return literal placeholders');expect(sent.options.throwOnError).toBe(true);
 expect(await planThirdOrderQuestions({objectives:[{...objective,_targetOrder:'second-order'}]},()=>{throw Error('should not call');})).toEqual([]);
});
it.each([{promptProfile:'compact'},{promptProfile:'local'},{blindSourceReview:true}])('uses a focused plan-first writer without second-order example defaults %s',profile=>{
 const prompt=buildMcqPrompt({...profile,count:1,objectives:[objective],writerIntegrationPlans:[{objectiveId:'o',firstRule:{quote:primary.quote},secondRule:{quote:support.quote}}],lectureText:(primary.quote+' '+support.quote).repeat(4),focusNotes:'REPAIR_FEEDBACK'});
 expect(prompt).toContain('Every question must require both links');
 expect(prompt).toContain('REPAIR_FEEDBACK');expect(prompt).toContain('SOURCE EVIDENCE CATALOG');
 expect(prompt).toContain('"orderLevel":"third-order"');expect(prompt).not.toContain('"orderLevel":"second-order"');
});
