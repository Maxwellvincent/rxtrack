import {it,expect,vi} from 'vitest';
import {validateConnectionDraft,prepareObjectiveConnections,objectiveConnectionMap,connectionStudyPlan,connectionPracticeRequest,objectivesWithConnectionGaps} from './objectiveConnections.js';
import {mergeSourceRelationships} from './sourceRelationships.js';
const objective={id:'o',blockId:'b',linkedLecId:'l',bloomLevel:4,objective:'Compare vibration pathways and their spinal laterality.'};
const quote='Dorsal columns carry vibration and position signals ipsilaterally in the spinal cord.';
const quote2='These signals cross in the medulla before ascending to the thalamus.';
const scope={blockId:'b',lectureId:'l',objectives:[objective],pages:[{page:2,text:quote+' '+quote2}]};
const first={key:'a',objectiveId:'o',clause:'vibration pathways',label:'Spinal pathway laterality',quote,page:2,kind:'text',explanation:'Connect the location of the pathway in the cord to the side of the sensory information it carries.',checkPrompt:'How does the cord position of this pathway predict the side of a sensory deficit?',prerequisites:[]};
const second={...first,key:'b',label:'Crossing changes the side',quote:quote2,prerequisites:['a']};
const draft={connections:[first,second]};
const mapCatalog=async()=>mergeSourceRelationships({},await prepareObjectiveConnections(scope,vi.fn().mockResolvedValueOnce(draft).mockResolvedValueOnce({approvedKeys:['a','b']})));
it('persists reviewed connections with exact source, objective and prerequisite identity',async()=>{
 const catalog=await mapCatalog(),map=objectiveConnectionMap(catalog,{},scope,100);
 expect(map[0].connections).toHaveLength(2);expect(map[0].connections[1].learning.prerequisiteIds).toEqual([map[0].connections[0].id]);
 expect(map[0].connections[0]).toMatchObject({attempts:0,practiceState:'unseen'});
});
it('rejects foreign objectives, invented source, cyclic/forward dependencies and duplicates',()=>{
 expect(validateConnectionDraft({connections:[{...first,objectiveId:'foreign'},{...first,quote:'Invented statement with no original source.'},{...first,prerequisites:['b']}]},scope)).toEqual([]);
 expect(validateConnectionDraft({connections:[first,{...first,key:'duplicate'}]},scope)).toHaveLength(1);
});
it('does not keep a dependent connection after its prerequisite fails independent review',async()=>{
 const call=vi.fn().mockResolvedValueOnce(draft).mockResolvedValueOnce({approvedKeys:['b']});
 expect(await prepareObjectiveConnections(scope,call)).toEqual([]);expect(call).toHaveBeenCalledTimes(2);
});
it('invalidates changed lecture evidence and changed objective wording without deleting history',async()=>{
 const catalog=await mapCatalog();
 expect(objectiveConnectionMap(catalog,{}, {...scope,pages:[{page:2,text:quote+' changed'}]})[0].connections).toEqual([]);
 expect(objectiveConnectionMap(catalog,{}, {...scope,objectives:[{...objective,objective:'Describe unrelated development.'}]})[0].connections).toEqual([]);
 expect(Object.keys(catalog.relationships)).toHaveLength(2);
});
it('does not distribute an objective-wide success to all its connections',async()=>{
 const catalog=await mapCatalog();
 const evidence={learningJournal:[{blockId:'b',lectureId:'l',objectiveIds:['o'],correct:true,at:1,questionKey:'old'}]};
 expect(objectiveConnectionMap(catalog,evidence,scope,100)[0].connections.every(row=>row.attempts===0)).toBe(true);
});
it('tracks specific misses, assistance, fresh application, delayed retest and repetition',async()=>{
 const catalog=await mapCatalog(),connection=objectiveConnectionMap(catalog,{},scope,100)[0].connections[0];
 const event={blockId:'b',lectureId:'l',objectiveIds:['o'],sourceRelationshipIds:[connection.id],relationshipSourceVersion:connection.sourceVersion,at:1,questionKey:'q1',sessionKey:'s1',correct:false};
 const evidence={learningJournal:[event]};
 let map=objectiveConnectionMap(catalog,evidence,scope,100);expect(map[0].connections.map(row=>row.practiceState)).toEqual(['repair','unseen']);
 const request=connectionPracticeRequest({...map[0].connections[0],objective});expect(request.objectives[0]).toMatchObject({_targetOrder:'second-order',_connectionTargetIds:[connection.id]});
 evidence.learningJournal.push({...event,correct:true,at:2});
 expect(objectiveConnectionMap(catalog,evidence,scope,100)[0].connections[0].practiceState).toBe('repair');
 evidence.learningJournal.push({...event,correct:true,at:3,questionKey:'q2',orderLevel:'second-order',reasoningVerified:true});
 map=objectiveConnectionMap(catalog,evidence,scope,86400004);expect(map[0].connections[0].practiceState).toBe('due');
 expect(connectionPracticeRequest({...map[0].connections[0],objective}).objectives[0]._targetOrder).toBe('third-order');
 expect(connectionStudyPlan(map)).toHaveLength(2);
});
it('keeps a broad ready objective in practice when its specific connections are untested',async()=>{
 const catalog=await mapCatalog();
 const targets=objectivesWithConnectionGaps([{...objective,status:'ready'}],catalog,{},scope,100);
 expect(targets[0]._conceptCoverageGap).toBe(true);expect(targets[0]._connectionTargetIds).toHaveLength(2);
});
it('retains teaching information when a reviewed question re-registers the same source connection',async()=>{
 const catalog=await mapCatalog(),row=Object.values(catalog.relationships)[0],{learning,...plain}=row;
 const next=mergeSourceRelationships(catalog,[{facet:catalog.facets[row.facetId],relationship:plain}]);expect(next.relationships[row.id].learning).toEqual(learning);
});
it.each([{objectiveId:'foreign'},{quote:'This invented relationship is absent from the actual source.'},{clause:'unrelated objective clause'},{prerequisites:['a']},{key:''}])('rejects ungrounded ownership, quotation, clauses and cyclic dependencies %s',change=>{
 expect(validateConnectionDraft({connections:[{...first,...change}]},scope)).toEqual([]);
});
it('does not keep a dependent teaching connection when its prerequisite fails review',async()=>{
 const bundles=await prepareObjectiveConnections(scope,vi.fn().mockResolvedValueOnce(draft).mockResolvedValueOnce({approvedKeys:['b']}));
 expect(bundles).toEqual([]);
});
it('does not inherit old objective-level scores or stale-source success',async()=>{
 const catalog=await mapCatalog();
 expect(objectiveConnectionMap(catalog,{objectives:{o:{attempts:20,correct:20}}},scope,100)[0].connections.every(row=>row.practiceState==='unseen')).toBe(true);
 expect(objectiveConnectionMap(catalog,{}, {...scope,pages:[{page:2,text:quote+' Updated content.'}]},100)[0].connections).toEqual([]);
});
it('shows assisted connection practice without counting it as independent understanding',async()=>{
 const catalog=await mapCatalog(),row=Object.values(catalog.relationships)[0];
 const evidence={assistedJournal:[{blockId:'b',lectureId:'l',objectiveIds:['o'],questionKey:'assisted',correct:true,at:1,assisted:true,sourceRelationshipIds:[row.id],relationshipSourceVersion:row.sourceVersion}]};
 const map=objectiveConnectionMap(catalog,evidence,scope,100);
 expect(map[0].connections[0]).toMatchObject({attempts:0,assistedAttempts:1,practiceState:'unseen'});
 expect(objectivesWithConnectionGaps([objective],catalog,evidence,scope,100)[0]._focusPriority).toBe(0);
});
