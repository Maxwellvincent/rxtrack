import {it,expect} from 'vitest';
import {lecturePracticeTargets,lectureProgressionPlan} from './lecturePracticeTargets.js';
import {objectivesWithPracticeEvidence} from '../../../engine/objectivePractice.js';
const objective={id:'o',blockId:'b',linkedLecId:'l',objective:'Predict the effects of lesions by integrating motor pathway relationships.',bloomLevel:4};
it('shows the same earned integration target used by the lecture quiz',()=>{
 const evidence={objectives:{o:{attempts:3,correct:3,recent:[true,true,true],orderLevels:{'second-order':{attempts:3,correct:3}}}}};
 const targets=lecturePracticeTargets(objectivesWithPracticeEvidence([objective],evidence),{},evidence,{blockId:'b',lectureId:'l',pages:[]});
 expect(targets[0]._targetOrder).toBe('third-order');expect(lectureProgressionPlan(targets,evidence).rows[0].targetOrder).toBe(targets[0]._targetOrder);
});
it('explains a targeted integration retest separately from earned application progression',()=>{
 const targets=[{...objective,_targetOrder:'third-order',_transferOrder:'third-order'}];
 const row=lectureProgressionPlan(targets,{}).rows[0];expect(row.applicationSecure).toBe(false);expect(row.targetOrder).toBe('third-order');expect(row.progressionReason).toContain('fresh integration retest');
});
it('a new correct confidence report alone does not advance the displayed or generated target',()=>{
 const evidence={objectives:{o:{attempts:1,correct:1,recent:[true],lastFreshAnswer:{confidence:5,correct:true,orderLevel:'second-order',reasoningVerified:true},orderLevels:{'second-order':{attempts:1,correct:1}}}}};
 const targets=lecturePracticeTargets(objectivesWithPracticeEvidence([objective],evidence),{},evidence,{blockId:'b',lectureId:'l',pages:[]});
 expect(targets[0]._targetOrder).toBe('second-order');expect(lectureProgressionPlan(targets,evidence).rows[0].targetOrder).toBe('second-order');
});
