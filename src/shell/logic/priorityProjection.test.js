import {it,expect} from 'vitest';
import {evidenceAwareObjectives} from './schedule.js';
import {objectivePracticePlan} from '../../engine/objectivePractice.js';
import {buildWeakAreaMap} from '../features/exam/weakAreaMap.js';
import {blockReadinessSummary} from '../features/today/blockReadiness.js';
it('keeps a recent miss and recovery consistent across scheduler, readiness, and weak areas',()=>{
 const objectives=[{id:'o',linkedLecId:'l',status:'mastered'}],lectures=[{id:'l',blockId:'nb2'}];
 for(const recent of [[false],[true,true,true,true]]){
  const learnerEvidence={objectives:{o:{attempts:4,correct:1,recent}}};
  const plan=objectivePracticePlan(objectives,learnerEvidence).rows[0];
  const weak=buildWeakAreaMap({lectures,objectives,learnerEvidence})[0];
  const readiness=blockReadinessSummary({blockId:'nb2',lectures,objectives,learnerEvidence});
  expect(evidenceAwareObjectives(objectives,learnerEvidence)[0].status).toBe(plan.state);
  expect(weak.strugglingObjectives).toBe(Number(plan.state==='struggling'));
  expect(readiness.objectives.struggling).toBe(Number(plan.state==='struggling'));
 }
});
it('withdraws mastery when the recorded answer evidence was explicitly excluded',()=>{
 const [o]=evidenceAwareObjectives([{id:'o',status:'mastered'}],{objectives:{o:{attempts:0,correct:0}}});
 expect(o.status).toBe('untested');
});
it('keeps review-only ratings in the review scheduler without converting them to question coverage',()=>{
 const objectives=[{id:'o',linkedLecId:'l',status:'mastered'}];
 expect(evidenceAwareObjectives(objectives)[0].status).toBe('mastered');
 expect(buildWeakAreaMap({lectures:[{id:'l'}],objectives})[0].objectivesUntested).toBe(1);
});
