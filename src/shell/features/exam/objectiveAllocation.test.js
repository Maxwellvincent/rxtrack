import {describe,it,expect} from 'vitest';
import {remainingObjectiveAllocation,fitsObjectiveAllocation} from './objectiveAllocation.js';
const plan=Array.from({length:9},(_,i)=>({id:`o${i}`,_targetQuestionCount:1,_targetOrder:'second-order'}));
describe('whole-exam objective quotas',()=>{
 it('rotates across nine targets over three batches without recording fake learner answers',()=>{
  const accepted=[];
  for(let batch=0;batch<3;batch++){
   const rows=remainingObjectiveAllocation(plan,accepted,3);
   expect(rows.map(row=>row.id)).toEqual(plan.slice(batch*3,batch*3+3).map(row=>row.id));
   accepted.push(...rows.map(row=>({objectiveIds:[row.id]})));
  }
  expect(remainingObjectiveAllocation(plan,accepted,3)).toEqual([]);
  expect(plan.every(row=>row._targetQuestionCount===1)).toBe(true);
 });
 it('reserves rejected slots and counts cached accepted work against the same quotas',()=>{
  expect(remainingObjectiveAllocation(plan,[{objectiveIds:['o1']}],3).map(row=>row.id)).toEqual(['o0','o2','o3']);
 });
 it('spreads a batch before repeating a target and preserves adaptive depth metadata',()=>{
  expect(remainingObjectiveAllocation([{...plan[0],_targetQuestionCount:4,_targetOrder:'third-order'},plan[1]],[],3)).toMatchObject([{id:'o0',_targetQuestionCount:2,_targetOrder:'third-order'},{id:'o1',_targetQuestionCount:1}]);
 });
 it('rejects an exhausted target, foreign ownership, unknown depth and a lower-order reserve',()=>{
  const remaining=[{...plan[0],_targetOrder:'third-order'}];
  expect(fitsObjectiveAllocation({objectiveIds:['o0'],orderLevel:'second-order'},remaining)).toBe(false);
  expect(fitsObjectiveAllocation({objectiveIds:['o0'],orderLevel:'third-order'},remaining)).toBe(true);
  expect(fitsObjectiveAllocation({objectiveIds:['o1'],orderLevel:'third-order'},remaining)).toBe(false);
  expect(fitsObjectiveAllocation({objectiveIds:['o0'],orderLevel:null},remaining)).toBe(false);
  expect(fitsObjectiveAllocation({objectiveIds:['o0'],orderLevel:'third-order'},[])).toBe(false);
 });
});
it('treats invalid quotas as empty rather than allocating unbounded work',()=>{
 expect(remainingObjectiveAllocation([{id:'missing'},{id:'infinite',_targetQuestionCount:Infinity},{id:'negative',_targetQuestionCount:-2}])).toEqual([]);
});
