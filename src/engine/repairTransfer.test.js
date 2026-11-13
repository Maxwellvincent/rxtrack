import {it,expect} from 'vitest';
import {repairTransferPlan,repairTransferRequest} from './repairTransfer.js';
const DAY=86400000,o={id:'o',blockId:'nb2',lectureId:'l',objective:'Localize pathways'};
const event=(overrides={})=>({at:1000,questionKey:'old',sessionKey:'s1',blockId:'nb2',lectureId:'l',objectiveIds:['o'],correct:true,assisted:true,learningContext:{topic:'Crossing',stem:'Original'},...overrides});
it('routes an assisted success to fresh second order application without granting independent recovery',()=>{
 const rows=repairTransferPlan([o],{},[event()],2000);expect(rows[0].state).toBe('transfer');expect(repairTransferRequest(rows).objectives[0]._targetOrder).toBe('second-order');
});
it('requires fresh verified matching application, then a different delayed session',()=>{
 const anchor=event(),good=event({at:2000,assisted:false,questionKey:'new',reasoningVerified:true,orderLevel:'second-order'});
 expect(repairTransferPlan([o],{},[anchor,good],3000)[0].state).toBe('waiting');
 expect(repairTransferPlan([o],{},[anchor,good],DAY+3000)[0].state).toBe('due');
 const delayed={...good,at:DAY+3000,sessionKey:'s2',questionKey:'later',orderLevel:'third-order'};
 expect(repairTransferPlan([o],{},[anchor,good,delayed],DAY+4000)).toEqual([]);
 for(const wrong of [{...good,questionKey:'old'},{...good,reasoningVerified:false},{...good,learningContext:{topic:'Other'}}])expect(repairTransferPlan([o],{},[anchor,wrong],DAY+4000)[0].state).toBe('transfer');
});
it('keeps scope and relationship source versions separate',()=>{
 const anchor=event({sourceRelationshipIds:['r'],relationshipSourceVersion:'v1'});
 const good=event({at:2000,questionKey:'new',assisted:false,reasoningVerified:true,orderLevel:'third-order',sourceRelationshipIds:['r'],relationshipSourceVersion:'v2'});
 expect(repairTransferPlan([o],{},[anchor,good],3000)[0].state).toBe('transfer');
 expect(repairTransferPlan([o],{},[event({blockId:'nb1'})],3000)).toEqual([]);
});
it('keeps distinct concepts under one objective and gives delayed depth precedence',()=>{
 const rows=repairTransferPlan([o],{},[event(),event({at:1100,questionKey:'other',learningContext:{topic:'Different connection'}})],2000);
 expect(rows).toHaveLength(2);
 const request=repairTransferRequest([{...rows[0],state:'due'},{...rows[1],state:'transfer'}]);
 expect(request.objectives).toHaveLength(1);expect(request.objectives[0]._transferOrder).toBe('third-order');
 expect(request.focusNotes).not.toContain('Original');
});
